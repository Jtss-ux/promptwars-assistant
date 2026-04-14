/**
 * @fileoverview LogicFlow: Code Review Assistant — Automated Test Suite.
 *
 * Uses the native Node.js test runner (`node:test`) with `node:assert`
 * for zero-dependency, production-grade testing.
 *
 * Test categories:
 *   1. Unit tests — sanitizeInput(), input validation logic.
 *   2. Integration tests — API endpoint behavior.
 *   3. E2E tests — full request→AI→response round-trip.
 *
 * Run:
 *   npm test
 *
 * @module app.test
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('Unit Tests: sanitizeInput()', () => {
  const { sanitizeInput } = require('./server');

  test('escapes HTML angle brackets to prevent XSS', () => {
    const input = '<script>alert("xss")</script>';
    const result = sanitizeInput(input);
    assert.ok(!result.includes('<'), 'Should not contain raw < character');
    assert.ok(!result.includes('>'), 'Should not contain raw > character');
    assert.ok(result.includes('&lt;'), 'Should contain escaped &lt;');
    assert.ok(result.includes('&gt;'), 'Should contain escaped &gt;');
  });

  test('escapes ampersands', () => {
    assert.ok(sanitizeInput('AT&T').includes('&amp;'));
  });

  test('escapes double quotes', () => {
    assert.ok(sanitizeInput('say "hello"').includes('&quot;'));
  });

  test('escapes single quotes', () => {
    assert.ok(sanitizeInput("it's").includes('&#x27;'));
  });

  test('returns empty string for non-string inputs', () => {
    assert.strictEqual(sanitizeInput(null), '');
    assert.strictEqual(sanitizeInput(undefined), '');
    assert.strictEqual(sanitizeInput(123), '');
    assert.strictEqual(sanitizeInput({}), '');
  });

  test('passes through clean strings unchanged', () => {
    const clean = 'Hello World 123';
    assert.strictEqual(sanitizeInput(clean), clean);
  });

  test('handles empty string', () => {
    assert.strictEqual(sanitizeInput(''), '');
  });
});

// ── Integration & E2E Tests ───────────────────────────────────────────────────

describe('API Integration Tests', { concurrency: false }, () => {
  let serverProcess;
  const PORT = 8081;
  const BASE_URL = `http://localhost:${PORT}`;

  before(async () => {
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT },
      stdio: 'pipe',
    });

    // Wait for the server to become responsive
    await new Promise((resolve, reject) => {
      let retries = 0;
      const MAX_RETRIES = 15;

      const checkHealth = async () => {
        try {
          const res = await fetch(`${BASE_URL}/health`);
          if (res.ok) return resolve();
          throw new Error('Health check returned non-OK status');
        } catch {
          retries++;
          if (retries > MAX_RETRIES) {
            serverProcess.kill();
            return reject(new Error('Server failed to start within timeout.'));
          }
          setTimeout(checkHealth, 500);
        }
      };
      checkHealth();
    });
  });

  after(() => {
    if (serverProcess) serverProcess.kill();
  });

  // ── Health Check ──────────────────────────────────────────────────────

  test('GET /health returns 200 with valid JSON payload', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(response.status, 200, 'HTTP status should be 200');

    const body = await response.json();
    assert.strictEqual(typeof body, 'object', 'Response body should be a JSON object');
    assert.strictEqual(body.status, 'ok', 'Status field should be "ok"');
    assert.ok(
      body.ai === 'gemini-api-key' || body.ai === 'vertex-ai-adc',
      'AI backend mode should be correctly identified',
    );
    assert.strictEqual(typeof body.uptime, 'number', 'Uptime should be a number');
  });

  // ── Input Validation ──────────────────────────────────────────────────

  test('POST /api/chat rejects requests with missing message', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(response.status, 400, 'Should return 400 Bad Request');
    const body = await response.json();
    assert.strictEqual(body.error, 'message is required');
  });

  test('POST /api/chat rejects non-string message types', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 12345 }),
    });

    assert.strictEqual(response.status, 400, 'Numeric message should be rejected');
  });

  test('POST /api/chat rejects messages exceeding length limit', async () => {
    const longMessage = 'a'.repeat(5001);
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: longMessage }),
    });

    assert.strictEqual(response.status, 400, 'Over-length message should return 400');
    const body = await response.json();
    assert.ok(body.error.includes('5000'), 'Error should mention the limit');
  });

  test('POST /api/chat rejects oversized code payloads', async () => {
    const hugeCode = 'x'.repeat(50001);
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'review', githubCode: hugeCode }),
    });

    assert.strictEqual(response.status, 400, 'Over-length code should return 400');
  });

  // ── Content-Type Validation ───────────────────────────────────────────

  test('POST /api/chat rejects non-JSON Content-Type', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });

    // Express may return 400 or 415 depending on parsing
    assert.ok(
      response.status >= 400,
      'Non-JSON content type should be rejected',
    );
  });

  // ── AI Response (E2E) ─────────────────────────────────────────────────

  test('POST /api/chat returns a successful AI-generated response', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is a closure in JavaScript?',
        context: 'General Developer Support',
      }),
    });

    assert.strictEqual(response.status, 200, 'Should return 200 OK');

    const body = await response.json();
    assert.ok(body.reply, 'Response should contain a reply field');
    assert.strictEqual(typeof body.reply, 'string', 'Reply must be a string');
    assert.ok(body.reply.length > 0, 'Reply should not be empty');
  });

  // ── Security Headers ──────────────────────────────────────────────────

  test('Responses include security headers from Helmet', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const headers = response.headers;

    assert.ok(
      headers.has('x-content-type-options'),
      'Should have X-Content-Type-Options header',
    );
    assert.ok(
      headers.has('x-frame-options') || headers.has('x-xss-protection'),
      'Should have frame/xss protection headers',
    );
  });

  // ── Static File Serving ───────────────────────────────────────────────

  test('GET / serves the index.html frontend', async () => {
    const response = await fetch(`${BASE_URL}/`);
    assert.strictEqual(response.status, 200, 'Root should return 200');

    const html = await response.text();
    assert.ok(html.includes('LogicFlow'), 'HTML should contain app name');
    assert.ok(html.includes('skip-link'), 'HTML should include skip navigation');
  });
});
