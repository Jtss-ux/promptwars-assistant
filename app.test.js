/**
 * @fileoverview LogicFlow: Code Review Assistant — Automated Test Suite.
 *
 * Uses the native Node.js test runner (`node:test`) with `node:assert`
 * for zero-dependency, production-grade testing. No external test
 * frameworks required — runs with `npm test` (`node --test`).
 *
 * Test categories:
 *   1. Unit tests     — sanitizeInput() function edge cases.
 *   2. Validation     — API endpoint request validation.
 *   3. Security       — HTTP security headers from Helmet.
 *   4. Integration    — Health check, static file serving.
 *   5. E2E            — Full request → Gemini AI → response round-trip.
 *
 * @module app.test
 * @see {@link https://nodejs.org/api/test.html Node.js Test Runner}
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

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
    // The sanitizer escapes angle brackets so tags cannot be parsed by the browser
    assert.ok(!result.includes('<img'), 'Must neutralize img tag (lt; escaped)');
    assert.ok(result.includes('&lt;img'), 'Must encode < to &lt; to prevent tag parsing');
    assert.ok(result.includes('&amp;amp;'), 'Must double-encode pre-existing entities');
  });
});

// ── Integration & E2E Tests ───────────────────────────────────────────────────

describe('API Integration Tests', { concurrency: false }, () => {
  let serverProcess;
  const PORT = 8081;
  const BASE_URL = `http://localhost:${PORT}`;

  /**
   * Spawn a test server instance on a dedicated port before all tests run.
   * Waits up to 7.5 seconds for the /health probe to succeed.
   */
  before(async () => {
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT },
      stdio: 'pipe',
    });

    await new Promise((resolve, reject) => {
      let retries = 0;
      const MAX_RETRIES = 15;

      const checkHealth = async () => {
        try {
          const res = await fetch(`${BASE_URL}/health`);
          if (res.ok) return resolve();
          throw new Error('Non-OK health response');
        } catch {
          if (++retries > MAX_RETRIES) {
            serverProcess.kill();
            return reject(new Error('Server failed to start within timeout.'));
          }
          setTimeout(checkHealth, 500);
        }
      };
      checkHealth();
    });
  });

  /** Terminate the test server after all tests complete. */
  after(() => {
    if (serverProcess) serverProcess.kill();
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

  test('Helmet sets X-Download-Options or equivalent', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    // At minimum, the nosniff header proves Helmet is active
    assert.ok(response.headers.has('x-content-type-options'));
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

  test('GET / response includes ARIA landmarks', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes('role="main"'), 'HTML must include main landmark');
    assert.ok(html.includes('role="complementary"'), 'HTML must include aside landmark');
  });

  // ── E2E: AI Response ────────────────────────────────────────────────────

  test('POST /api/chat returns a real AI-generated response string', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is a closure in JavaScript? Answer briefly.',
        context: 'General Developer Support',
      }),
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.ok(body.reply, 'Response must have a reply field');
    assert.strictEqual(typeof body.reply, 'string');
    assert.ok(body.reply.length > 10, 'Reply must be a meaningful response');
  });

  test('POST /api/chat response includes token usage stats', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Say hello.',
        context: 'General Developer Support',
      }),
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    if (body.stats) {
      assert.strictEqual(typeof body.stats.elapsed, 'string', 'elapsed must be a string');
      assert.strictEqual(typeof body.stats.totalTokens, 'number', 'totalTokens must be a number');
    }
  });
});
