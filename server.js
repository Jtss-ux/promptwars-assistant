/**
 * @fileoverview LogicFlow: Code Review Assistant — Server Entry Point.
 *
 * A context-aware developer assistant powered by multiple Google Cloud services:
 *  - Google Gemini (gemini-2.5-flash) — conversational AI via Developer API
 *  - Vertex AI (gemini-2.0-flash)     — fallback via Application Default Credentials
 *  - Google Cloud Run                  — auto-scaling serverless deployment
 *  - Google Cloud Logging              — structured JSON log ingestion
 *  - Google Search Grounding           — real-time factual AI responses
 *  - Google Cloud Firestore            — conversation history persistence
 *  - Google Cloud Secret Manager       — secure API-key retrieval
 *  - Google Cloud Monitoring           — custom metrics & observability
 *
 * @module server
 * @requires express
 * @requires cors
 * @requires helmet
 * @requires compression
 * @requires express-rate-limit
 * @requires dotenv
 * @requires @google-cloud/firestore
 * @requires @google-cloud/secret-manager
 * @requires @google-cloud/monitoring
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ─── Google Cloud Utility Modules ────────────────────────────────────────────
const { saveConversationTurn } = require('./src/utils/firestore');
const { recordChatRequest, recordAiLatency } = require('./src/utils/metrics');
const { getSecret } = require('./src/utils/secrets');

// Note: additional modular implementations live in:
//   src/middleware/security.js — Helmet, CORS, rate-limit config
//   src/routes/chat.js        — POST /api/chat router
//   src/routes/health.js      — GET /health & /api/version routers
//   src/utils/ai.js           — Gemini / Vertex AI client abstraction
//   src/utils/cache.js        — in-memory response cache
//   src/utils/sanitize.js     — input sanitization utilities
//   src/utils/logger.js       — structured Cloud Logging helper

// ─── Custom Error Class ───────────────────────────────────────────────────────

/**
 * Application-level error with an associated HTTP status code.
 * Enables clean, structured error propagation through middleware.
 *
 * @class AppError
 * @extends Error
 */
class AppError extends Error {
  /**
   * @param {string} message  - Human-readable error description.
   * @param {number} status   - HTTP status code (e.g. 400, 415, 500).
   */
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

// ─── Express App Initialization ───────────────────────────────────────────────

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────

/**
 * Helmet sets various HTTP security response headers to protect against
 * common web vulnerabilities (XSS, clickjacking, MIME sniffing, etc.).
 *
 * CSP is tuned to allow:
 *  - Google Fonts (fonts.googleapis.com, fonts.gstatic.com)
 *  - Highlight.js + Marked from cdnjs (cdnjs.cloudflare.com)
 *  - Inline styles required by the markdown renderer
 *  - No unsafe-eval; scripts must come from self or the approved CDN
 *
 * @see {@link https://helmetjs.github.io/ Helmet.js documentation}
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        'cdnjs.cloudflare.com',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",          // required by highlight.js theme injection
        'fonts.googleapis.com',
        'cdnjs.cloudflare.com',
      ],
      fontSrc: [
        "'self'",
        'fonts.gstatic.com',
      ],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // required for CDN resources
  frameguard: { action: 'SAMEORIGIN' },
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

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum length of a user message in characters. */
const MAX_MESSAGE_LENGTH = 5000;

/** Maximum length of an attached GitHub code payload in characters. */
const MAX_CODE_LENGTH = 50000;

// ─── In-Memory Response Cache ─────────────────────────────────────────────────

/**
 * A lightweight in-memory cache for AI-generated responses.
 *
 * Keyed by a normalized `context:message` string, this avoids redundant
 * round-trips to the Gemini API for identical prompts within the TTL window.
 * The cache auto-evicts entries older than {@link CACHE_TTL_MS} and caps at
 * {@link MAX_CACHE_ENTRIES} to prevent unbounded memory growth.
 *
 * @type {Map<string, {reply: string, stats: Object, timestamp: number}>}
 */
const responseCache = new Map();

/** Cache entry time-to-live: 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of cached entries before oldest entries are evicted. */
const MAX_CACHE_ENTRIES = 100;

/**
 * Generate a normalized cache key from context and message.
 * Short-messages only (≤200 chars) are cached to avoid storing huge payloads.
 *
 * @param {string} context - Execution context string.
 * @param {string} message - User message.
 * @returns {string|null} Cache key, or null if the response should not be cached.
 */
function getCacheKey(context, message) {
  if (message.length > 200) return null; // Don't cache large code-heavy queries
  return `${context}::${message.trim().toLowerCase()}`;
}

/**
 * Purge all cache entries whose TTL has expired, plus oldest entries
 * if the cache has grown beyond {@link MAX_CACHE_ENTRIES}.
 *
 * @returns {void}
 */
function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      responseCache.delete(key);
    }
  }
  // If still over limit, evict oldest entries (Map preserves insertion order)
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const excess = responseCache.size - MAX_CACHE_ENTRIES;
    let evicted = 0;
    for (const key of responseCache.keys()) {
      if (evicted < excess) {
        responseCache.delete(key);
        evicted++;
      } else {
        break;
      }
    }
  }
}

// ─── Response-Time Middleware ─────────────────────────────────────────────────

/**
 * Attach an `X-Response-Time` header to every response showing the elapsed
 * server-side processing time in milliseconds.  Useful for performance
 * monitoring and Cloud Logging correlation.
 *
 * @param {express.Request}  req  - Express request.
 * @param {express.Response} res  - Express response.
 * @param {Function}         next - Next middleware.
 */
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);

  res.end = (...args) => {
    const elapsedNs = process.hrtime.bigint() - start;
    const elapsedMs = Number(elapsedNs / 1_000_000n);
    // Only set if headers haven't been sent yet (guards against double-end)
    if (!res.headersSent) {
      res.setHeader('X-Response-Time', `${elapsedMs}ms`);
    }
    return originalEnd(...args);
  };

  next();
});

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Sanitize user input by escaping HTML entities to prevent XSS attacks.
 * Applied server-side as a defence-in-depth measure for display and logging.
 * NOTE: Do NOT pass sanitized strings to the AI prompt — sanitization
 * introduces HTML entities (e.g. &amp;lt;) that degrade response quality.
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
 * Validate that a string is safe raw input (no HTML tags, no script patterns).
 * Used to guard raw strings before passing to the AI prompt.
 *
 * @param {string} str - The raw user input string.
 * @returns {boolean} True if the string is considered safe for AI consumption.
 */
function isSafeForPrompt(str) {
  if (typeof str !== 'string') return false;
  // Reject payloads containing obvious script-injection patterns
  const dangerous = /<script[\s>]/i.test(str) || /javascript:/i.test(str);
  return !dangerous;
}

/**
 * Emit a structured JSON log entry fully compatible with Google Cloud Logging.
 *
 * The log format follows the Cloud Logging structured logging specification:
 * - `severity`    maps to Cloud Logging severity levels (INFO, WARNING, ERROR).
 * - `message`     is the primary human-readable log line.
 * - `httpRequest` is an optional structured field automatically parsed by
 *   Cloud Logging to populate the request log viewer.
 * - `labels`      attaches the service name for log-based metric filtering.
 *
 * When deployed to Cloud Run, stdout/stderr is automatically forwarded to
 * Cloud Logging, and these structured entries are indexed with proper
 * severity filtering, log-based metrics, and alerting support.
 *
 * @param {string} severity          - Log severity: 'INFO' | 'WARNING' | 'ERROR'.
 * @param {string} message           - Human-readable description of the event.
 * @param {Object} [meta]            - Optional structured key-value metadata.
 * @param {Object} [httpRequestInfo] - Optional HTTP request context for Cloud Logging.
 * @returns {void}
 * @see {@link https://cloud.google.com/logging/docs/structured-logging Cloud Logging Structured Logging}
 * @see {@link https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest HttpRequest field spec}
 */
function log(severity, message, meta = {}, httpRequestInfo = null) {
  const entry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    'logging.googleapis.com/labels': { service: 'logicflow-assistant' },
    ...meta,
  };
  if (httpRequestInfo) {
    entry.httpRequest = httpRequestInfo;
  }
  const output = JSON.stringify(entry);
  if (severity === 'ERROR') {
    console.error(output);
  } else {
    console.log(output);
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
 * @throws {AppError} If the AI service is unreachable or returns an error.
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
 * @param {string} userMessage - The original user message (raw, not sanitized).
 * @param {string} context     - The selected execution context category.
 * @returns {string} A Markdown-formatted fallback response.
 */
function getFallbackResponse(userMessage, context) {
  // Escape message for safe display in Markdown
  const safeMsg = sanitizeInput(userMessage).slice(0, 120);

  const fallbacks = {
    'Code Review & Optimization': `## Code Review Tips\n\n**For your query**: *${safeMsg}*\n\n- Use \`enumerate()\` instead of \`range(len())\`\n- Replace nested loops with dict lookups (O(1) vs O(n))\n- Use \`numpy\` vectorization for numerical operations\n- Profile with \`cProfile\` before optimizing\n\n\`\`\`python\n# Instead of:\nfor i in range(len(arr)):\n    for j in range(len(arr)):\n        ...\n# Use:\nlookup = {val: idx for idx, val in enumerate(arr)}\n\`\`\``,
    'System Architecture Design': `## Architecture Guidance\n\n**For your query**: *${safeMsg}*\n\n- Apply **SOLID principles** — single responsibility, open/closed\n- Prefer **microservices** for independently scalable components\n- Use **event-driven patterns** (pub/sub) for async workflows\n- Design for **failure** — circuit breakers, retries, timeouts`,
    'Debugging & Error Resolution': `## Debugging Strategy\n\n**For your query**: *${safeMsg}*\n\n1. **Reproduce** reliably first — exact inputs matter\n2. **Bisect** the code — reduce scope with binary search\n3. **Add structured logging** at boundary points\n4. Check **race conditions** if async/threaded\n5. Use \`pdb\` (Python) or \`debugger;\` (JS) for interactive inspection`,
  };

  return fallbacks[context]
    || `## LogicFlow Response\n\n**For your query**: *${safeMsg}*\n\nHere's expert advice for *${context || 'General'}*:\n\n- Break your problem into **small, testable units**\n- Write clear **function signatures** with type hints\n- Use **version control** (git) for every experiment\n- Measure before optimizing — profile first, fix bottlenecks second`;
}

// ─── API Routes ───────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 *
 * Accepts a user message, optional execution context, and an optional
 * GitHub code snippet.  Constructs a context-aware prompt and forwards
 * it to Google Gemini for a response.
 *
 * IMPORTANT: Raw (un-sanitized) user strings are passed to the AI prompt
 * to preserve natural language and code semantics.  Sanitization is applied
 * only to log entries and fallback display text to prevent XSS.
 *
 * @route POST /api/chat
 * @param {string}  req.body.message      - The user's chat message (required).
 * @param {string}  [req.body.context]    - Execution context category.
 * @param {string}  [req.body.githubCode] - Raw code fetched from GitHub.
 * @returns {{ reply: string, stats?: Object }} JSON response.
 */
app.post('/api/chat', chatLimiter, async (req, res) => {
  // Prevent caching of AI-generated responses (sensitive, personalised content)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    // ── Content-Type Guard ─────────────────────────────────────────────────
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      throw new AppError('Content-Type must be application/json.', 415);
    }

    // ── Extract & Validate Fields ──────────────────────────────────────────
    const { message, context: rawContext, githubCode: rawCode } = req.body;

    if (!message || typeof message !== 'string') {
      throw new AppError('message is required and must be a string.', 400);
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new AppError(`Message exceeds ${MAX_MESSAGE_LENGTH} character limit.`, 400);
    }
    if (rawCode && typeof rawCode !== 'string') {
      throw new AppError('githubCode must be a string.', 400);
    }
    if (rawCode && rawCode.length > MAX_CODE_LENGTH) {
      throw new AppError(`Code payload exceeds ${MAX_CODE_LENGTH} character limit.`, 400);
    }
    if (!isSafeForPrompt(message)) {
      throw new AppError('Message contains disallowed content.', 400);
    }

    // Raw strings are passed directly to the AI to preserve semantics.
    // Sanitization (HTML-escaping) is applied only for logging/display.
    const rawMessage = message;
    const context = (typeof rawContext === 'string' && rawContext.trim())
      ? rawContext.trim()
      : 'General Developer Support';

    // ── Prompt Construction ───────────────────────────────────────────────
    let prompt = `You are LogicFlow: Code Review Assistant, a senior software engineer AI.
Current session context: ${context}.
User query: "${rawMessage}"

CRITICAL RESPONSE RULES:
- ALWAYS provide answers strictly to the point. Stop immediately once the question is answered.
- ONLY elaborate or provide explanation when explicitly asked by the user.
- AVOID giving unnecessary explanations, boilerplate text, or generic advice.
- If the user asks a simple question (e.g., "how to be a data analyst"), give a concise 2-3 sentence answer/list without filler text.
- Match the response length exactly to the complexity of the question. Short question = short direct answer.
- Use Markdown formatting for code blocks, lists, and headings to ensure readability.`;

    if (rawCode) {
      prompt += `\n\n**SUPPLIED GITHUB CODE TO REVIEW:**\n\`\`\`\n${rawCode}\n\`\`\`\nPlease review the above code directly based on the user's query.`;
    }

    // -- AI Invocation (with in-memory cache) -----------------------------------
    const cacheKey = getCacheKey(context, rawMessage);

    // Serve from cache if a valid, unexpired entry exists
    if (cacheKey) {
      const cached = responseCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
        log('INFO', 'Cache hit -- returning cached AI response.', { context, cacheKey });
        res.setHeader('X-Cache', 'HIT');
        // Fire-and-forget: record cache hit metric
        recordChatRequest({ cached: true, context }).catch(() => {});
        return res.json({ reply: cached.reply, stats: cached.stats, cached: true });
      }
    }

    res.setHeader('X-Cache', 'MISS');
    const startTime = Date.now();
    const result = await getAIResponse(prompt);
    const elapsedMs = Date.now() - startTime;

    log('INFO', 'Chat response generated.', {
      context: sanitizeInput(context),
      elapsedMs,
      promptTokens: result.promptTokens,
      totalTokens: result.totalTokens,
    }, {
      requestMethod: req.method,
      requestUrl: req.originalUrl,
      status: 200,
      userAgent: req.headers['user-agent'] || '',
      latency: `${(elapsedMs / 1000).toFixed(3)}s`,
    });

    const responseBody = {
      reply: result.text,
      stats: {
        elapsed: (elapsedMs / 1000).toFixed(2),
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
      },
    };

    // Store successful AI response in cache for future identical queries
    if (cacheKey) {
      responseCache.set(cacheKey, {
        reply: responseBody.reply,
        stats: responseBody.stats,
        timestamp: Date.now(),
      });
      pruneCache();
    }

    // ── Google Cloud Integrations (fire-and-forget) ──────────────────────────
    // Persist conversation turn to Firestore for history & analytics
    saveConversationTurn({
      sessionId:   req.headers['x-session-id'] || 'anonymous',
      context,
      userMessage: rawMessage,
      aiReply:     result.text,
      tokens:      result.totalTokens,
      elapsedMs,
      cached:      false,
    }).catch(() => {}); // never block the response

    // Record custom metrics to Cloud Monitoring
    recordChatRequest({ cached: false, context }).catch(() => {});
    recordAiLatency(elapsedMs).catch(() => {});

    return res.json(responseBody);

  } catch (err) {
    // Known application errors — return appropriate HTTP status
    if (err instanceof AppError) {
      log('WARNING', `AppError: ${err.message}`, { status: err.status });
      return res.status(err.status).json({ error: err.message });
    }

    // Unexpected errors — log and provide intelligent fallback
    log('ERROR', 'Chat endpoint unexpected error.', { error: err.message });

    const { message = '', context = '' } = req.body || {};
    const fallback = getFallbackResponse(
      typeof message === 'string' ? message : '',
      typeof context === 'string' ? context : '',
    );

    return res.json({ reply: fallback });
  }
});

// ─── Health Check (used by Cloud Run readiness/liveness probes) ───────────────

/**
 * GET /health
 *
 * Returns a simple JSON object indicating server status, the configured
 * AI backend, Node.js version, and uptime.  Used by Cloud Run health checks
 * and by the E2E test suite to confirm server readiness.
 *
 * @route GET /health
 * @returns {{ status: string, ai: string, uptime: number, node: string }} JSON health payload.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ai: process.env.GEMINI_API_KEY ? 'gemini-api-key' : 'vertex-ai-adc',
    uptime: Math.floor(process.uptime()),
    node: process.version,
    env: process.env.NODE_ENV || 'development',
  });
});

// ─── Version / Info Endpoint ──────────────────────────────────────────────────

/**
 * GET /api/version
 *
 * Returns application metadata for observability dashboards and
 * integration tests.
 *
 * @route GET /api/version
 * @returns {{ name: string, version: string, googleServices: string[] }} JSON.
 */
app.get('/api/version', (_req, res) => {
  const { cacheSize } = require('./src/utils/cache');
  res.json({
    name: 'logicflow-code-review-assistant',
    version: '1.0.0',
    googleServices: [
      'Google Gemini (gemini-2.5-flash)  — conversational AI via Developer API',
      'Vertex AI (gemini-2.0-flash-001)  — ADC fallback on Cloud Run',
      'Google Cloud Run                   — auto-scaling serverless host',
      'Google Cloud Logging               — structured JSON log ingestion',
      'Google Search Grounding            — real-time factual AI responses',
      'Google Cloud Firestore             — conversation history persistence',
      'Google Cloud Secret Manager       — secure API-key retrieval',
      'Google Cloud Monitoring            — custom observability metrics',
    ],
    cacheEntries: cacheSize(),
    runtime: 'Node.js',
    runtimeVersion: process.version,
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

/**
 * Express 4/5 catch-all error middleware.
 * Only invoked for errors passed via next(err) or unhandled throws in async routes.
 *
 * @param {Error}            err  - The error object.
 * @param {express.Request}  req  - Express request.
 * @param {express.Response} res  - Express response.
 * @param {Function}         next - Next middleware (required by Express signature).
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof AppError ? err.status : 500;
  log('ERROR', err.message, { stack: err.stack });
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

// ─── Server Start ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 8080;

/**
 * Bootstrap: attempt to load GEMINI_API_KEY from Google Cloud Secret Manager.
 * If Secret Manager is unavailable (local dev), falls back to the GEMINI_API_KEY
 * environment variable silently.
 *
 * This ensures the API key is never stored in source control while remaining
 * available in Cloud Run via the Secret Manager IAM binding.
 */
async function bootstrapSecrets() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (project && !process.env.GEMINI_API_KEY) {
    const secretName = `projects/${project}/secrets/gemini-api-key/versions/latest`;
    const key = await getSecret(secretName, process.env.GEMINI_API_KEY);
    if (key) {
      process.env.GEMINI_API_KEY = key;
      log('INFO', 'GEMINI_API_KEY loaded from Secret Manager.', { project });
    }
  }
}

// Only start listening when run directly (not when require'd by tests)
if (require.main === module) {
  bootstrapSecrets()
    .catch((err) => log('WARNING', 'Secret Manager bootstrap failed.', { error: err.message }))
    .finally(() => {
      const server = app.listen(PORT, () => {
        log('INFO', `LogicFlow server running on port ${PORT}.`, { port: PORT });
      });

      // ── Graceful Shutdown ─────────────────────────────────────────────────

      /**
       * Handle SIGTERM (sent by Cloud Run during scale-down) to close
       * active connections gracefully before the process exits.
       */
      process.on('SIGTERM', () => {
        log('INFO', 'SIGTERM received. Shutting down gracefully.');
        server.close(() => {
          log('INFO', 'Server closed (SIGTERM).');
          process.exit(0);
        });
      });

      /**
       * Handle SIGINT (Ctrl+C in development) for clean local shutdowns.
       */
      process.on('SIGINT', () => {
        log('INFO', 'SIGINT received. Shutting down gracefully.');
        server.close(() => {
          log('INFO', 'Server closed (SIGINT).');
          process.exit(0);
        });
      });
    });
}

module.exports = { app, sanitizeInput, isSafeForPrompt, AppError, getCacheKey, pruneCache };
