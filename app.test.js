const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');

describe('LogicFlow E2E API Tests', { concurrency: false }, () => {
  let serverProcess;
  const PORT = 8081; // Use custom port for testing to prevent conflicts
  const BASE_URL = `http://localhost:${PORT}`;

  before(async () => {
    // Spawn server as child process
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT }
    });

    // Wait until the server becomes responsive
    await new Promise((resolve, reject) => {
      let retries = 0;
      const checkHealth = async () => {
        try {
          const res = await fetch(`${BASE_URL}/health`);
          if (res.ok) resolve();
          else throw new Error('Not OK');
        } catch (e) {
          retries++;
          if (retries > 10) {
            serverProcess.kill();
            reject(new Error('Server failed to start in time.'));
          } else {
            setTimeout(checkHealth, 500);
          }
        }
      };
      checkHealth();
    });
  });

  after(() => {
    // Teardown the server process after tests finish
    if (serverProcess) {
       serverProcess.kill();
    }
  });

  test('GET /health returns 200 OK and valid JSON', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(response.status, 200, 'HTTP status should be 200');
    
    const body = await response.json();
    assert.strictEqual(typeof body, 'object', 'Response body should be JSON object');
    assert.strictEqual(body.status, 'ok', 'Status inside JSON should be ok');
    assert.ok(body.ai === 'gemini-api-key' || body.ai === 'vertex-ai-adc', 'AI mode should be correctly identified');
  });

  test('POST /api/chat rejects empty requests', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    assert.strictEqual(response.status, 400, 'Should return bad request for empty message');
    const body = await response.json();
    assert.strictEqual(body.error, 'message is required', 'Should return appropriate error message');
  });

  test('POST /api/chat responds successfully with AI markdown text', async () => {
    // Sending a simple test message to Gemini
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Hello, how can you help me perform bug detection?', 
        context: 'Bug Detection & Error Resolution' 
      })
    });

    assert.strictEqual(response.status, 200, 'API request should return 200 OK status');
    
    const body = await response.json();
    assert.ok(body.reply, 'Response should contain a reply text field');
    assert.strictEqual(typeof body.reply, 'string', 'Reply must be a string (Markdown format)');
  });
});
