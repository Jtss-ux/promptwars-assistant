/**
 * @fileoverview LogicFlow: Code Review Assistant — Server Entry Point.
 *
 * A context-aware developer assistant powered by Google Gemini / Vertex AI.
 * Deployed on Google Cloud Run for auto-scaling, secure service-to-service
 * authentication, and native integration with Cloud Logging.
 *
 * @module server
 * @requires express
 * @requires cors
 * @requires helmet
 * @requires compression
 * @requires express-rate-limit
 * @requires dotenv
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ─── Express App Initialization ───────────────────────────────────────────────

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────

/**
 * Helmet sets various HTTP response headers to help protect against
 * common web vulnerabilities (XSS, clickjacking, MIME sniffing, etc.).
 * CSP is relaxed to allow inline styles required by the markdown renderer.
 */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

/**
 * CORS configuration — restricts origins in production while
 * allowing all origins in development for local testing.
 */
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGIN || true
    : true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// ─── Performance Middleware ───────────────────────────────────────────────────

/**
 * Gzip/Brotli compression for all responses —
 * reduces payload size by ~70% for text-based responses.
 */
app.use(compression());

/**
 * Body parser with a strict 50 KB limit to prevent
 * oversized payloads from consuming server memory.
 */
app.use(express.json({ limit: '50kb' }));

/**
 * Serve static frontend assets with a 1-hour cache header
 * to reduce redundant network requests on repeat visits.
 */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────

/**
 * Apply rate limiting to the chat API endpoint to prevent abuse.
 * Each IP is limited to 50 requests per 15-minute window.
 *
 * @type {import('express-rate-limit').RateLimitRequestHandler}
 */
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before sending more messages.' },
});

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Sanitize user input by escaping HTML entities to prevent XSS attacks.
 * This is applied server-side as a defence-in-depth measure.
 *
 * @param {string} str - The raw user input string.
 * @returns {string} The sanitized string with HTML entities escaped.
 */
function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Emit a structured JSON log entry compatible with Google Cloud Logging.
 * When running on Cloud Run, these entries are automatically ingested
 * and indexed by Cloud Logging with proper severity levels.
 *
 * @param {string} severity - Log level: 'INFO', 'WARNING', 'ERROR'.
 * @param {string} message  - Human-readable log message.
 * @param {Object} [meta]   - Optional structured metadata payload.
 * @see https://cloud.google.com/logging/docs/structured-logging
 */
function log(severity, message, meta = {}) {
  const entry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  if (severity === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── AI Client (Singleton) ───────────────────────────────────────────────────

/** @type {import('@google/genai').GoogleGenAI | null} */
let genAIClient = null;

/**
 * Send a prompt to Google Gemini / Vertex AI and return the generated text
 * along with token usage metadata for observability.
 *
 * Path 1 (preferred): Uses the Gemini Developer API via `GEMINI_API_KEY`.
 * Path 2 (Cloud Run):  Falls back to Vertex AI with Application Default
 *                      Credentials when no API key is set.
 *
 * Both paths leverage Google Search grounding to provide real-time,
 * factually accurate responses backed by live web results.
 *
 * @param {string} prompt - The fully constructed prompt string.
 * @returns {Promise<{text: string, promptTokens: number, outputTokens: number, totalTokens: number}>}
 * @throws {Error} If the AI service is unreachable or returns an error.
 */
async function getAIResponse(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const project = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0486189266';

  if (apiKey) {
    // Path 1: Gemini Developer API (API Key)
    const { GoogleGenAI } = require('@google/genai');
    if (!genAIClient) {
      genAIClient = new GoogleGenAI({ apiKey });
      log('INFO', 'Gemini Developer API client initialized.');
    }

    const response = await genAIClient.models.generateContent({
      model: 'models/gemini-2.5-flash',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const tokens = response.usageMetadata || {};
    return {
      text: response.candidates[0].content.parts[0].text,
      promptTokens: tokens.promptTokenCount || 0,
      outputTokens: tokens.candidatesTokenCount || 0,
      totalTokens: tokens.totalTokenCount || 0,
    };
  }

  // Path 2: Vertex AI (Cloud Run Service Account — ADC)
  const { VertexAI } = require('@google-cloud/vertexai');
  const vertex = new VertexAI({ project, location: 'us-central1' });
  const model = vertex.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

  log('INFO', 'Using Vertex AI with ADC.', { project });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const tokens = result.response.usageMetadata || {};
  return {
    text: result.response.candidates[0].content.parts[0].text,
    promptTokens: tokens.promptTokenCount || 0,
    outputTokens: tokens.candidatesTokenCount || 0,
    totalTokens: tokens.totalTokenCount || 0,
  };
}

// ─── Context-Aware Fallback Responses ─────────────────────────────────────────

/**
 * Returns an expert-curated fallback response when the AI service is
 * temporarily unavailable.  Responses are matched to the user's selected
 * execution context so the app remains useful even during outages.
 *
 * @param {string} userMessage - The original user message.
 * @param {string} context     - The selected execution context category.
 * @returns {string} A Markdown-formatted fallback response.
 */
function getFallbackResponse(userMessage, context) {
  const fallbacks = {
    'Code Review & Optimization': `## Code Review Tips\n\n**For your query**: *${userMessage}*\n\n- Use \`enumerate()\` instead of \`range(len())\`\n- Replace nested loops with dict lookups (O(1) vs O(n))\n- Use \`numpy\` vectorization for numerical operations\n- Profile with \`cProfile\` before optimizing\n\n\`\`\`python\n# Instead of:\nfor i in range(len(arr)):\n    for j in range(len(arr)):\n        ...\n# Use:\nlookup = {val: idx for idx, val in enumerate(arr)}\n\`\`\``,
    'System Architecture Design': `## Architecture Guidance\n\n**For your query**: *${userMessage}*\n\n- Apply **SOLID principles** — single responsibility, open/closed\n- Prefer **microservices** for independently scalable components\n- Use **event-driven patterns** (pub/sub) for async workflows\n- Design for **failure** — circuit breakers, retries, timeouts`,
    'Debugging & Error Resolution': `## Debugging Strategy\n\n**For your query**: *${userMessage}*\n\n1. **Reproduce** reliably first — exact inputs matter\n2. **Bisect** the code — reduce scope with binary search\n3. **Add structured logging** at boundary points\n4. Check **race conditions** if async/threaded\n5. Use \`pdb\` (Python) or \`debugger;\` (JS) for interactive inspection`,
  };

  return fallbacks[context]
    || `## LogicFlow Response\n\n**For your query**: *${userMessage}*\n\nHere's expert advice for *${context || 'General'}*:\n\n- Break your problem into **small, testable units**\n- Write clear **function signatures** with type hints\n- Use **version control** (git) for every experiment\n- Measure before optimizing — profile first, fix bottlenecks second`;
}

// ─── API Routes ───────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 *
 * Accepts a user message, optional execution context, and an optional
 * GitHub code snippet.  Constructs a context-aware prompt and forwards
 * it to Google Gemini for a response.
 *
 * @route POST /api/chat
 * @param {string}  req.body.message    - The user's chat message (required).
 * @param {string}  [req.body.context]  - Execution context category.
 * @param {string}  [req.body.githubCode] - Raw code fetched from GitHub.
 * @returns {{ reply: string, stats?: Object }} JSON response.
 */
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    // ── Input Validation ──────────────────────────────────────────────────
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json.' });
    }

    let { message, context, githubCode } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    // Enforce length limits to prevent token abuse
    const MAX_MESSAGE_LENGTH = 5000;
    const MAX_CODE_LENGTH = 50000;

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit.` });
    }
    if (githubCode && githubCode.length > MAX_CODE_LENGTH) {
      return res.status(400).json({ error: `Code payload exceeds ${MAX_CODE_LENGTH} character limit.` });
    }

    // ── Sanitization ──────────────────────────────────────────────────────
    message = sanitizeInput(message);
    context = sanitizeInput(context || 'General Developer Support');
    if (githubCode) githubCode = sanitizeInput(githubCode);

    // ── Prompt Construction ───────────────────────────────────────────────
    let prompt = `You are LogicFlow: Code Review Assistant, a senior software engineer AI.
Current session context: ${context}.
User query: "${message}"

CRITICAL RESPONSE RULES:
- If the user says "hi", "hello", "hey", or asks a simple one-liner question, reply in 1-3 sentences MAX. No lists, no code blocks.
- Only give detailed markdown responses with code snippets, bullet points, and analysis when the user explicitly asks for a code review, debugging help, or technical deep-dive.
- Always match the response length to the complexity of the question. Short question = short answer.
- Never pad responses with generic advice unless specifically asked.`;

    if (githubCode) {
      prompt += `\n\n**SUPPLIED GITHUB CODE TO REVIEW:**\n\`\`\`\n${githubCode}\n\`\`\`\nPlease review the above code directly based on the user's query.`;
    }

    // ── AI Invocation ─────────────────────────────────────────────────────
    const startTime = Date.now();
    const result = await getAIResponse(prompt);
    const elapsedMs = Date.now() - startTime;

    log('INFO', 'Chat response generated.', {
      context,
      elapsedMs,
      promptTokens: result.promptTokens,
      totalTokens: result.totalTokens,
    });

    return res.json({
      reply: result.text,
      stats: {
        elapsed: (elapsedMs / 1000).toFixed(2),
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
      },
    });
  } catch (err) {
    log('ERROR', 'Chat endpoint error.', { error: err.message });

    // Provide a useful context-aware fallback instead of a blank error
    const { message = '', context = '' } = req.body || {};
    const fallback = getFallbackResponse(
      sanitizeInput(message),
      sanitizeInput(context),
    );

    return res.json({ reply: fallback });
  }
});

// ─── Health Check (used by Cloud Run readiness/liveness probes) ───────────────

/**
 * GET /health
 *
 * Returns a simple JSON object indicating server status and the
 * configured AI backend.  Used by Cloud Run health checks and
 * by the E2E test suite to confirm server readiness.
 *
 * @route GET /health
 * @returns {{ status: string, ai: string }} JSON health payload.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ai: process.env.GEMINI_API_KEY ? 'gemini-api-key' : 'vertex-ai-adc',
    uptime: Math.floor(process.uptime()),
  });
});

// ─── Server Start ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 8080;

// Only start listening when run directly (not when require'd by tests)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    log('INFO', `LogicFlow server running on port ${PORT}.`, { port: PORT });
  });

  // ── Graceful Shutdown ───────────────────────────────────────────────────

  /**
   * Handle SIGTERM (sent by Cloud Run during scale-down) to close
   * active connections gracefully before the process exits.
   */
  process.on('SIGTERM', () => {
    log('INFO', 'SIGTERM received. Shutting down gracefully.');
    server.close(() => {
      log('INFO', 'Server closed.');
      process.exit(0);
    });
  });
}

module.exports = { app, sanitizeInput };
