'use strict';

/**
 * @fileoverview Health check and version API route handlers.
 *
 * Provides two informational endpoints used by:
 *  - **Cloud Run** liveness and readiness probes (`GET /health`)
 *  - Observability dashboards and integration tests (`GET /api/version`)
 *
 * These routes carry no authentication requirement and return only
 * non-sensitive metadata about the running service.
 *
 * @module routes/health
 */

const express = require('express');
const { cacheSize } = require('../utils/cache');

const router = express.Router();

/**
 * GET /health
 *
 * Lightweight liveness probe used by Cloud Run to determine whether the
 * container is ready to accept traffic. Returns a JSON object with:
 *  - `status`  — always `"ok"` if the server is alive
 *  - `ai`      — active AI backend identifier
 *  - `uptime`  — server uptime in whole seconds
 *  - `node`    — Node.js version string
 *  - `env`     — current NODE_ENV value
 *
 * @route GET /health
 * @returns {{ status: string, ai: string, uptime: number, node: string, env: string }}
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ai: process.env.GEMINI_API_KEY ? 'gemini-api-key' : 'vertex-ai-adc',
    uptime: Math.floor(process.uptime()),
    node: process.version,
    env: process.env.NODE_ENV || 'development',
  });
});

/**
 * GET /api/version
 *
 * Returns application metadata for observability dashboards,
 * CI/CD pipelines, and integration test verification.
 *
 * @route GET /api/version
 * @returns {{ name: string, version: string, googleServices: string[], cacheEntries: number, runtime: string, runtimeVersion: string }}
 */
router.get('/api/version', (_req, res) => {
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

module.exports = router;
