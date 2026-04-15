'use strict';

/**
 * @fileoverview Security middleware configuration for LogicFlow.
 *
 * Centralizes all HTTP security configuration in one place:
 *  - **Helmet**        — sets hardened HTTP response headers (CSP, HSTS, nosniff, etc.)
 *  - **CORS**          — restricts allowed origins and HTTP methods
 *  - **Rate Limiting** — caps requests per IP to prevent API abuse
 *
 * All middleware exported here are applied globally in `server.js` during
 * app initialization before any route handlers.
 *
 * @see {@link https://helmetjs.github.io/ Helmet.js}
 * @see {@link https://www.npmjs.com/package/cors cors}
 * @see {@link https://www.npmjs.com/package/express-rate-limit express-rate-limit}
 * @module middleware/security
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

/**
 * Helmet middleware pre-configured for LogicFlow.
 *
 * Content Security Policy allows:
 *  - Google Fonts (fonts.googleapis.com + fonts.gstatic.com)
 *  - highlight.js + marked from cdnjs (cdnjs.cloudflare.com)
 *  - Inline styles required by highlight.js theming
 *  - No `unsafe-eval` — all scripts must originate from approved CDNs or self
 *
 * @type {import('express').RequestHandler}
 */
const helmetMiddleware = helmet({
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
});

/**
 * CORS middleware — restricts cross-origin access in production.
 * In development all origins are allowed for local testing convenience.
 *
 * @type {import('express').RequestHandler}
 */
const corsMiddleware = cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGIN || true
    : true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
});

/**
 * Chat API rate limiter: 50 requests per IP per 15-minute window.
 * Prevents API abuse and protects against prompt-flooding attacks.
 *
 * Applied only to POST /api/chat (not to health checks or static files).
 *
 * @type {import('express-rate-limit').RateLimitRequestHandler}
 */
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before sending more messages.' },
});

module.exports = { helmetMiddleware, corsMiddleware, chatLimiter };
