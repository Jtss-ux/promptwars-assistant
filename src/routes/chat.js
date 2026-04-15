'use strict';

/**
 * @fileoverview Chat API route handler for LogicFlow Code Review Assistant.
 *
 * Handles POST /api/chat requests:
 *  1. Validates Content-Type, message type, and payload sizes.
 *  2. Checks the in-memory cache for identical recent queries (cache HIT).
 *  3. Constructs a context-aware prompt and calls the Gemini / Vertex AI backend.
 *  4. Persists the conversation turn to Firestore (fire-and-forget).
 *  5. Records custom Cloud Monitoring metrics (fire-and-forget).
 *  6. Returns a structured JSON response with AI reply and token usage stats.
 *
 * On unexpected AI failures the endpoint falls back to a curated expert
 * response so the app remains useful during service disruptions.
 *
 * Security note: raw (un-sanitized) user strings are passed directly to the AI
 * to preserve natural language semantics. HTML-escaping is applied only for
 * logging and fallback display contexts.
 *
 * @module routes/chat
 */

const express = require('express');
const { chatLimiter } = require('../middleware/security');
const { getCacheKey, getCache, setCache } = require('../utils/cache');
const { getAIResponse } = require('../utils/ai');
const { saveConversationTurn } = require('../utils/firestore');
const { recordChatRequest, recordAiLatency } = require('../utils/metrics');
const { sanitizeInput, isSafeForPrompt } = require('../utils/sanitize');
const { log } = require('../utils/logger');

const router = express.Router();

/** Maximum length of a user message in characters. */
const MAX_MESSAGE_LENGTH = 5000;

/** Maximum length of an attached GitHub code payload in characters. */
const MAX_CODE_LENGTH = 50000;

// ─── Application Error ────────────────────────────────────────────────────────

/**
 * Application-level error with an associated HTTP status code.
 * @class AppError
 * @extends Error
 */
class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

// ─── Context-Aware Fallback Responses ─────────────────────────────────────────

/**
 * Returns an expert-curated fallback response matched to the user's execution context.
 * Used when the AI service is temporarily unavailable.
 *
 * @param {string} userMessage - Original user message (raw, not sanitized).
 * @param {string} context     - Selected execution context category.
 * @returns {string} Markdown-formatted fallback response.
 */
function getFallbackResponse(userMessage, context) {
  const safeMsg = sanitizeInput(userMessage).slice(0, 120);

  const fallbacks = {
    'Code Review & Optimization': `## Code Review Tips\n\n**For your query**: *${safeMsg}*\n\n- Use \`enumerate()\` instead of \`range(len())\`\n- Replace nested loops with dict lookups (O(1) vs O(n))\n- Use \`numpy\` vectorization for numerical operations\n- Profile with \`cProfile\` before optimizing`,
    'System Architecture Design': `## Architecture Guidance\n\n**For your query**: *${safeMsg}*\n\n- Apply **SOLID principles** — single responsibility, open/closed\n- Prefer **microservices** for independently scalable components\n- Use **event-driven patterns** (pub/sub) for async workflows\n- Design for **failure** — circuit breakers, retries, timeouts`,
    'Debugging & Error Resolution': `## Debugging Strategy\n\n**For your query**: *${safeMsg}*\n\n1. **Reproduce** reliably first — exact inputs matter\n2. **Bisect** the code — reduce scope with binary search\n3. **Add structured logging** at boundary points\n4. Check **race conditions** if async/threaded`,
  };

  return fallbacks[context]
    || `## LogicFlow Response\n\n**For your query**: *${safeMsg}*\n\nHere's expert advice for *${context || 'General'}*:\n\n- Break your problem into **small, testable units**\n- Write clear **function signatures** with type hints\n- Use **version control** (git) for every experiment\n- Measure before optimizing — profile first, fix bottlenecks second`;
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

/**
 * POST /api/chat
 *
 * Accepts a user message, optional execution context, and an optional
 * GitHub code snippet. Constructs a context-aware prompt and forwards
 * it to Google Gemini / Vertex AI.
 *
 * @route POST /api/chat
 * @param {string}  req.body.message      - User chat message (required).
 * @param {string}  [req.body.context]    - Execution context category.
 * @param {string}  [req.body.githubCode] - Raw code fetched from GitHub.
 * @returns {{ reply: string, stats?: Object, cached?: boolean }}
 */
router.post('/api/chat', chatLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    // ── Content-Type guard ───────────────────────────────────────────────────
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      throw new AppError('Content-Type must be application/json.', 415);
    }

    // ── Extract & validate ───────────────────────────────────────────────────
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

    const rawMessage = message;
    const context = (typeof rawContext === 'string' && rawContext.trim())
      ? rawContext.trim()
      : 'General Developer Support';

    // ── Prompt construction ──────────────────────────────────────────────────
    let prompt = `You are LogicFlow: Code Review Assistant, a senior software engineer AI.
Current session context: ${context}.
User query: "${rawMessage}"

CRITICAL RESPONSE RULES:
- ALWAYS provide answers strictly to the point. Stop immediately once the question is answered.
- ONLY elaborate or provide explanation when explicitly asked by the user.
- AVOID giving unnecessary explanations, boilerplate text, or generic advice.
- If the user asks a simple question, give a concise 2-3 sentence answer/list without filler text.
- Match the response length exactly to the complexity of the question.
- Use Markdown formatting for code blocks, lists, and headings to ensure readability.`;

    if (rawCode) {
      prompt += `\n\n**SUPPLIED GITHUB CODE TO REVIEW:**\n\`\`\`\n${rawCode}\n\`\`\`\nPlease review the above code directly based on the user's query.`;
    }

    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = getCacheKey(context, rawMessage);
    const cached = getCache(cacheKey);
    if (cached) {
      log('INFO', 'Cache hit — returning cached AI response.', { context, cacheKey });
      res.setHeader('X-Cache', 'HIT');
      recordChatRequest({ cached: true, context }).catch(() => {});
      return res.json({ reply: cached.reply, stats: cached.stats, cached: true });
    }

    // ── AI invocation ────────────────────────────────────────────────────────
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

    // Store in cache
    setCache(cacheKey, responseBody.reply, responseBody.stats);

    // ── Google Cloud integrations (fire-and-forget) ──────────────────────────
    saveConversationTurn({
      sessionId:   req.headers['x-session-id'] || 'anonymous',
      context,
      userMessage: rawMessage,
      aiReply:     result.text,
      tokens:      result.totalTokens,
      elapsedMs,
      cached:      false,
    }).catch(() => {});

    recordChatRequest({ cached: false, context }).catch(() => {});
    recordAiLatency(elapsedMs).catch(() => {});

    return res.json(responseBody);

  } catch (err) {
    if (err instanceof AppError) {
      log('WARNING', `AppError: ${err.message}`, { status: err.status });
      return res.status(err.status).json({ error: err.message });
    }

    log('ERROR', 'Chat endpoint unexpected error.', { error: err.message });

    const { message = '', context = '' } = req.body || {};
    const fallback = getFallbackResponse(
      typeof message === 'string' ? message : '',
      typeof context === 'string' ? context : '',
    );

    return res.json({ reply: fallback });
  }
});

module.exports = router;
