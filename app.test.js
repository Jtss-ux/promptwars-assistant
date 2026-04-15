/**
 * @fileoverview LogicFlow: Code Review Assistant — Automated Test Suite.
 *
 * Uses the native Node.js test runner (`node:test`) with `node:assert`
 * for zero-dependency, production-grade testing. No external test
 * frameworks required — runs with `npm test` (`node --test`).
 *
 * Test categories:
 *   1. Unit Tests     — sanitizeInput(), isSafeForPrompt(), AppError
 *   2. Validation     — API endpoint request validation & boundaries
 *   3. Content-Type   — Strict media type enforcement
 *   4. Security       — HTTP security headers set by Helmet
 *   5. Integration    — Health check, version, static file serving
 *   6. Accessibility  — ARIA landmarks verification in served HTML
 *   7. E2E            — Full request → AI → response round-trip
 *
 * @module app.test
 * @see {@link https://nodejs.org/api/test.html Node.js Test Runner}
 */

'use strict';

// Ensure underlying services do not trigger async network loops during testing
process.env.NODE_ENV = 'test';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Unit Tests: sanitizeInput() ───────────────────────────────────────────────

describe('Unit Tests: sanitizeInput()', () => {
  const { sanitizeInput } = require('./server');

  test('escapes HTML angle brackets to prevent XSS injection', () => {
    const input = '<script>alert("xss")</script>';
    const result = sanitizeInput(input);
    assert.ok(!result.includes('<'), 'Must not contain raw < character');
    assert.ok(!result.includes('>'), 'Must not contain raw > character');
    assert.ok(result.includes('&lt;'), 'Must contain escaped &lt;');
    assert.ok(result.includes('&gt;'), 'Must contain escaped &gt;');
  });

  test('escapes ampersands before other entities to avoid double-encoding', () => {
    assert.ok(sanitizeInput('AT&T').includes('&amp;'));
    assert.ok(!sanitizeInput('AT&T').includes('&&'));
  });

  test('escapes double quotes (attribute injection prevention)', () => {
    assert.ok(sanitizeInput('say "hello"').includes('&quot;'));
  });

  test('escapes single quotes (JavaScript injection prevention)', () => {
    assert.ok(sanitizeInput("it's").includes('&#x27;'));
  });

  test('returns empty string for null input', () => {
    assert.strictEqual(sanitizeInput(null), '');
  });

  test('returns empty string for undefined input', () => {
    assert.strictEqual(sanitizeInput(undefined), '');
  });

  test('returns empty string for numeric input', () => {
    assert.strictEqual(sanitizeInput(123), '');
  });

  test('returns empty string for object input', () => {
    assert.strictEqual(sanitizeInput({}), '');
  });

  test('returns empty string for array input', () => {
    assert.strictEqual(sanitizeInput([]), '');
  });

  test('passes through clean alphanumeric strings unchanged', () => {
    const clean = 'Hello World 123';
    assert.strictEqual(sanitizeInput(clean), clean);
  });

  test('handles empty string without error', () => {
    assert.strictEqual(sanitizeInput(''), '');
  });

  test('handles combined XSS payload with multiple attack vectors', () => {
    const payload = '<img src=x onerror="alert(\'xss\')">&amp;';
    const result = sanitizeInput(payload);
    assert.ok(!result.includes('<img'), 'Must neutralize img tag (lt; escaped)');
    assert.ok(result.includes('&lt;img'), 'Must encode < to &lt; to prevent tag parsing');
    assert.ok(result.includes('&amp;amp;'), 'Must double-encode pre-existing entities');
  });

  test('handles very long strings without throwing', () => {
    const long = 'a'.repeat(100_000);
    assert.doesNotThrow(() => sanitizeInput(long));
    assert.strictEqual(sanitizeInput(long).length, 100_000);
  });

  test('sanitizes a boolean (coerced non-string)', () => {
    assert.strictEqual(sanitizeInput(false), '');
    assert.strictEqual(sanitizeInput(true), '');
  });
});

// ── Unit Tests: isSafeForPrompt() ─────────────────────────────────────────────

describe('Unit Tests: isSafeForPrompt()', () => {
  const { isSafeForPrompt } = require('./server');

  test('returns true for a normal developer question', () => {
    assert.strictEqual(isSafeForPrompt('What is a closure in JavaScript?'), true);
  });

  test('returns false for <script> injection attempt', () => {
    assert.strictEqual(isSafeForPrompt('<script>alert(1)</script>'), false);
  });

  test('returns false for javascript: URI scheme injection', () => {
    assert.strictEqual(isSafeForPrompt('javascript:void(0)'), false);
  });

  test('returns false for null input', () => {
    assert.strictEqual(isSafeForPrompt(null), false);
  });

  test('returns false for undefined input', () => {
    assert.strictEqual(isSafeForPrompt(undefined), false);
  });

  test('returns true for empty string', () => {
    assert.strictEqual(isSafeForPrompt(''), true);
  });

  test('returns true for code that naturally contains angle brackets (Markdown)', () => {
    // Generic < and > in code context should not be flagged unless combined as <script>
    assert.strictEqual(isSafeForPrompt('compare: 5 < 10, type<T> generics'), true);
  });
});

// ── Unit Tests: AppError ──────────────────────────────────────────────────────

describe('Unit Tests: AppError', () => {
  const { AppError } = require('./server');

  test('AppError is an instance of Error', () => {
    const err = new AppError('test', 400);
    assert.ok(err instanceof Error);
  });

  test('AppError carries correct message and status', () => {
    const err = new AppError('Bad input', 400);
    assert.strictEqual(err.message, 'Bad input');
    assert.strictEqual(err.status, 400);
  });

  test('AppError defaults to status 500 when no status supplied', () => {
    const err = new AppError('Internal');
    assert.strictEqual(err.status, 500);
  });

  test('AppError.name is "AppError"', () => {
    const err = new AppError('Test');
    assert.strictEqual(err.name, 'AppError');
  });
});

// ── Integration & E2E Tests ───────────────────────────────────────────────────

describe('API Integration Tests', { concurrency: false }, () => {
  let serverInstance;
  const PORT = 8081;
  const BASE_URL = `http://localhost:${PORT}`;

  /**
   * Start the Express app directly on a dedicated test port.
   * Using app.listen() avoids child-process spawn race conditions on Windows.
   */
  before(async () => {
    const { app } = require('./server');
    await new Promise((resolve, reject) => {
      serverInstance = app.listen(PORT, (err) => {
        if (err) {return reject(err);}
        resolve();
      });
      serverInstance.on('error', reject);
    });
  });

  /** Close the test server after all tests complete. */
  after(async () => {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
  });

  // ── Health Check ────────────────────────────────────────────────────────

  test('GET /health returns 200 with valid JSON shape', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(response.status, 200);

    const body = await response.json();
    assert.strictEqual(typeof body, 'object');
    assert.strictEqual(body.status, 'ok');
    assert.ok(
      body.ai === 'gemini-api-key' || body.ai === 'vertex-ai-adc',
      'AI backend must be identified correctly',
    );
    assert.strictEqual(typeof body.uptime, 'number');
    assert.ok(body.uptime >= 0, 'Uptime must be non-negative');
  });

  test('GET /health response includes node version field', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const body = await response.json();
    assert.ok(typeof body.node === 'string', 'node version must be a string');
    assert.ok(body.node.startsWith('v'), 'node version must start with "v"');
  });

  // ── Version Endpoint ────────────────────────────────────────────────────

  test('GET /api/version returns 200 with metadata', async () => {
    const response = await fetch(`${BASE_URL}/api/version`);
    assert.strictEqual(response.status, 200);

    const body = await response.json();
    assert.strictEqual(body.name, 'logicflow-code-review-assistant');
    assert.strictEqual(typeof body.version, 'string');
    assert.ok(Array.isArray(body.googleServices), 'googleServices must be an array');
    assert.ok(body.googleServices.length > 0, 'Must list at least one Google service');
  });

  test('GET /api/version lists Google Cloud Run service', async () => {
    const response = await fetch(`${BASE_URL}/api/version`);
    const body = await response.json();
    const servicesStr = body.googleServices.join(' ');
    assert.ok(
      servicesStr.toLowerCase().includes('cloud run'),
      'Must mention Google Cloud Run',
    );
  });

  // ── Input Validation ────────────────────────────────────────────────────

  test('POST /api/chat rejects empty body (missing message)', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.ok(body.error, 'Should return an error field');
  });

  test('POST /api/chat rejects numeric message type', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 12345 }),
    });
    assert.strictEqual(response.status, 400);
  });

  test('POST /api/chat rejects boolean message type', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: true }),
    });
    assert.strictEqual(response.status, 400);
  });

  test('POST /api/chat rejects array message type', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: ['hello'] }),
    });
    assert.strictEqual(response.status, 400);
  });

  test('POST /api/chat rejects null message', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: null }),
    });
    assert.strictEqual(response.status, 400);
  });

  test('POST /api/chat rejects message exceeding 5000 char limit', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'a'.repeat(5001) }),
    });
    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.ok(body.error.includes('5000'), 'Error should reference the limit');
  });

  test('POST /api/chat rejects code payload exceeding 50000 chars', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'review', githubCode: 'x'.repeat(50001) }),
    });
    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.ok(body.error.includes('50000'), 'Error should reference the code limit');
  });

  test('POST /api/chat accepts message at exact 5000 char boundary', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'a'.repeat(5000) }),
    });
    // At the boundary it should be accepted (200 or AI response)
    assert.ok(response.status !== 400, 'Exactly 5000 chars should not be rejected');
  });

  test('POST /api/chat rejects XSS script injection in message', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '<script>alert(1)</script>' }),
    });
    assert.ok(response.status === 400, 'XSS payload in message must be rejected');
    const body = await response.json();
    assert.ok(body.error, 'Must return error field');
  });

  test('POST /api/chat rejects non-string githubCode', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'review this', githubCode: 12345 }),
    });
    assert.strictEqual(response.status, 400);
  });

  // ── Content-Type Validation ─────────────────────────────────────────────

  test('POST /api/chat rejects text/plain Content-Type', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    assert.ok(response.status >= 400, 'Non-JSON Content-Type must be rejected');
  });

  test('POST /api/chat rejects multipart/form-data Content-Type', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: 'field=value',
    });
    assert.ok(response.status >= 400, 'Multipart Content-Type must be rejected');
  });

  test('POST /api/chat rejects application/x-www-form-urlencoded Content-Type', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'message=hello',
    });
    assert.ok(response.status >= 400, 'Form-urlencoded Content-Type must be rejected');
  });

  // ── Security Headers (Helmet) ───────────────────────────────────────────

  test('Helmet sets X-Content-Type-Options: nosniff', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(
      response.headers.get('x-content-type-options'),
      'nosniff',
      'Must prevent MIME type sniffing',
    );
  });

  test('Helmet sets X-Frame-Options or CSP frame-ancestors', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const hasFrame = response.headers.has('x-frame-options');
    const hasCsp = response.headers.has('content-security-policy');
    assert.ok(hasFrame || hasCsp, 'Must protect against clickjacking');
  });

  test('Content-Security-Policy header is present on static files', async () => {
    const response = await fetch(`${BASE_URL}/`);
    assert.ok(
      response.headers.has('content-security-policy'),
      'CSP header must be set on served pages',
    );
  });

  test('Content-Security-Policy does not include unsafe-eval', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const csp = response.headers.get('content-security-policy') || '';
    assert.ok(
      !csp.includes("'unsafe-eval'"),
      'CSP must not permit eval() execution',
    );
  });

  test('Cache-Control: no-store is set on /api/chat responses', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
    });
    const cc = response.headers.get('cache-control') || '';
    assert.ok(cc.includes('no-store'), 'AI responses must not be cached');
  });

  // ── Static File Serving ─────────────────────────────────────────────────

  test('GET / serves index.html with 200 status', async () => {
    const response = await fetch(`${BASE_URL}/`);
    assert.strictEqual(response.status, 200);
  });

  test('GET / response contains LogicFlow app identifier', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('LogicFlow'), 'HTML must contain app name');
  });

  test('GET / response contains skip-link for accessibility', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('skip-link'), 'HTML must include an accessible skip-navigation link');
  });

  test('GET / response includes lang attribute on <html>', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('lang="en"'), 'HTML element must declare language for screen readers');
  });

  test('GET /style.css returns 200 with text/css content type', async () => {
    const response = await fetch(`${BASE_URL}/style.css`);
    assert.strictEqual(response.status, 200);
    assert.ok(
      (response.headers.get('content-type') || '').includes('text/css'),
      'CSS file must be served as text/css',
    );
  });

  test('GET /app.js returns 200 with JavaScript content type', async () => {
    const response = await fetch(`${BASE_URL}/app.js`);
    assert.strictEqual(response.status, 200);
    const ct = response.headers.get('content-type') || '';
    assert.ok(
      ct.includes('javascript') || ct.includes('application/'),
      'JS file must be served as a script type',
    );
  });

  test('GET /nonexistent returns 404', async () => {
    const response = await fetch(`${BASE_URL}/this-path-does-not-exist`);
    assert.strictEqual(response.status, 404);
  });

  // ── Accessibility: ARIA Landmarks in HTML ───────────────────────────────

  test('GET / response includes ARIA main landmark', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('role="main"'), 'HTML must include main landmark');
  });

  test('GET / response includes ARIA complementary landmark (sidebar)', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('role="complementary"'), 'HTML must include aside landmark');
  });

  test('GET / response includes ARIA live region for announcements', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('aria-live'), 'HTML must include aria-live region for screen readers');
  });

  test('GET / response includes aria-label on interactive elements', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('aria-label'), 'HTML must include aria-label attributes');
  });

  test('GET / response uses semantic <header> element', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('<header'), 'HTML must use semantic header element');
  });

  test('GET / response uses semantic <aside> element for sidebar', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('<aside'), 'HTML must use semantic aside element');
  });

  // ── E2E: AI Response ────────────────────────────────────────────────────

  test('POST /api/chat returns an AI or fallback response string', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is a closure in JavaScript? Answer briefly.',
        context: 'General Developer Support',
      }),
    });

    // Always 200: either a real AI reply or the expert fallback response
    assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
    const body = await response.json();
    assert.ok(body.reply, 'Response must have a reply field');
    assert.strictEqual(typeof body.reply, 'string');
    assert.ok(body.reply.length > 5, 'Reply must be a non-trivial response');
  });

  test('POST /api/chat response shape is well-formed JSON', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Say hello.',
        context: 'General Developer Support',
      }),
    });

    // Response must be parseable JSON with either reply or error field
    const body = await response.json();
    assert.ok(
      typeof body === 'object' && body !== null,
      'Response body must be a JSON object',
    );
    const hasExpectedField = 'reply' in body || 'error' in body;
    assert.ok(hasExpectedField, 'Response must have either reply or error field');
    if (body.stats) {
      assert.strictEqual(typeof body.stats.elapsed, 'string', 'elapsed must be a string');
      assert.strictEqual(typeof body.stats.totalTokens, 'number', 'totalTokens must be a number');
      assert.ok(parseFloat(body.stats.elapsed) >= 0, 'elapsed must be non-negative');
    }
  });

  test('POST /api/chat with Code Review context returns structured JSON', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'How do I improve this: for i in range(len(arr)): print(arr[i])',
        context: 'Code Review & Optimization',
      }),
    });
    // Must return JSON regardless of AI availability
    const body = await response.json();
    assert.ok(typeof body === 'object', 'Response must be a JSON object');
    const hasField = 'reply' in body || 'error' in body;
    assert.ok(hasField, 'Response must have reply or error field');
    if (body.reply) {
      assert.ok(body.reply.length > 5, 'Non-empty reply must be meaningful');
    }
  });
});

// ── Unit Tests: Cache Module ───────────────────────────────────────────────────

describe('Unit Tests: Cache Module (src/utils/cache.js)', () => {
  const { getCacheKey, getCache, setCache, cacheSize, CACHE_TTL_MS, MAX_CACHE_ENTRIES } = require('./src/utils/cache');

  test('getCacheKey returns null for messages over 200 chars', () => {
    const longMsg = 'a'.repeat(201);
    assert.strictEqual(getCacheKey('ctx', longMsg), null);
  });

  test('getCacheKey returns null for empty message', () => {
    assert.strictEqual(getCacheKey('ctx', ''), null);
  });

  test('getCacheKey normalises to lowercase and trims whitespace', () => {
    const k1 = getCacheKey('Code Review', '  Hello World  ');
    const k2 = getCacheKey('Code Review', 'hello world');
    assert.strictEqual(k1, k2, 'Keys must be identical after normalisation');
  });

  test('getCacheKey includes context prefix in key', () => {
    const key = getCacheKey('Architecture', 'hello');
    assert.ok(key.startsWith('Architecture::'), 'Key must include context prefix');
  });

  test('setCache and getCache round-trip returns stored data', () => {
    const key = getCacheKey('test-ctx', 'unit test hit');
    setCache(key, 'cached reply', { elapsed: '0.10', totalTokens: 42 });
    const result = getCache(key);
    assert.ok(result !== null, 'Cache hit must return data');
    assert.strictEqual(result.reply, 'cached reply');
    assert.strictEqual(result.stats.totalTokens, 42);
  });

  test('getCache returns null for unknown key', () => {
    assert.strictEqual(getCache('nonexistent::key'), null);
  });

  test('getCache returns null for null key', () => {
    assert.strictEqual(getCache(null), null);
  });

  test('cacheSize returns a non-negative integer', () => {
    assert.ok(typeof cacheSize() === 'number');
    assert.ok(cacheSize() >= 0);
  });

  test('CACHE_TTL_MS is 5 minutes (300000 ms)', () => {
    assert.strictEqual(CACHE_TTL_MS, 5 * 60 * 1000);
  });

  test('MAX_CACHE_ENTRIES is 100', () => {
    assert.strictEqual(MAX_CACHE_ENTRIES, 100);
  });
});

// ── Unit Tests: Sanitize Module ────────────────────────────────────────────────

describe('Unit Tests: Sanitize Module (src/utils/sanitize.js)', () => {
  const { sanitizeInput, isSafeForPrompt } = require('./src/utils/sanitize');

  test('sanitizeInput escapes < and > brackets', () => {
    const out = sanitizeInput('<b>bold</b>');
    assert.ok(out.includes('&lt;') && out.includes('&gt;'));
  });

  test('sanitizeInput escapes & ampersand', () => {
    assert.ok(sanitizeInput('a & b').includes('&amp;'));
  });

  test('sanitizeInput returns empty string for non-string input', () => {
    assert.strictEqual(sanitizeInput(42), '');
    assert.strictEqual(sanitizeInput(null), '');
  });

  test('isSafeForPrompt returns false for <script> injection', () => {
    assert.strictEqual(isSafeForPrompt('<script>alert(1)</script>'), false);
  });

  test('isSafeForPrompt returns false for javascript: URI', () => {
    assert.strictEqual(isSafeForPrompt('javascript:void(0)'), false);
  });

  test('isSafeForPrompt returns true for normal code query', () => {
    assert.strictEqual(isSafeForPrompt('How do I sort an array in Python?'), true);
  });

  test('isSafeForPrompt returns false for non-string input', () => {
    assert.strictEqual(isSafeForPrompt(null), false);
    assert.strictEqual(isSafeForPrompt(undefined), false);
  });
});

// ── Integration Tests: /api/version endpoint ──────────────────────────────────

describe('Integration Tests: /api/version', () => {
  let server;
  let BASE_URL;

  before(async () => {
    const { app } = require('./server');
    const PORT = 8083;
    BASE_URL = `http://localhost:${PORT}`;
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /api/version returns 200 with JSON', async () => {
    const res = await fetch(`${BASE_URL}/api/version`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('application/json'));
  });

  test('GET /api/version includes name field', async () => {
    const body = await (await fetch(`${BASE_URL}/api/version`)).json();
    assert.strictEqual(body.name, 'logicflow-code-review-assistant');
  });

  test('GET /api/version lists at least 8 Google Services', async () => {
    const body = await (await fetch(`${BASE_URL}/api/version`)).json();
    assert.ok(Array.isArray(body.googleServices), 'googleServices must be an array');
    assert.ok(body.googleServices.length >= 8, `Must list ≥8 Google Services, got ${body.googleServices.length}`);
  });

  test('GET /api/version includes Firestore in services', async () => {
    const body = await (await fetch(`${BASE_URL}/api/version`)).json();
    const hasFirestore = body.googleServices.some(s => s.toLowerCase().includes('firestore'));
    assert.ok(hasFirestore, 'googleServices must reference Firestore');
  });

  test('GET /api/version includes Secret Manager in services', async () => {
    const body = await (await fetch(`${BASE_URL}/api/version`)).json();
    const hasSecretManager = body.googleServices.some(s => s.toLowerCase().includes('secret'));
    assert.ok(hasSecretManager, 'googleServices must reference Secret Manager');
  });

  test('GET /api/version includes Cloud Monitoring in services', async () => {
    const body = await (await fetch(`${BASE_URL}/api/version`)).json();
    const hasMonitoring = body.googleServices.some(s => s.toLowerCase().includes('monitoring'));
    assert.ok(hasMonitoring, 'googleServices must reference Cloud Monitoring');
  });

  test('GET /api/version includes cacheEntries field', async () => {
    const body = await (await fetch(`${BASE_URL}/api/version`)).json();
    assert.ok(typeof body.cacheEntries === 'number', 'cacheEntries must be a number');
  });

  test('GET /api/version includes runtimeVersion field', async () => {
    const body = await (await fetch(`${BASE_URL}/api/version`)).json();
    assert.ok(typeof body.runtimeVersion === 'string');
    assert.ok(body.runtimeVersion.startsWith('v'));
  });
});
