'use strict';

/**
 * @fileoverview AI client abstraction for LogicFlow Code Review Assistant.
 *
 * Provides a single `getAIResponse(prompt)` function that routes to the
 * appropriate Google AI backend:
 *
 *  - **Path 1 (preferred):** Gemini Developer API via `GEMINI_API_KEY` env var.
 *    Uses `gemini-2.5-flash` with Google Search grounding for real-time answers.
 *  - **Path 2 (Cloud Run):** Vertex AI with Application Default Credentials (ADC)
 *    when no API key is present (e.g. Cloud Run service account).
 *
 * The Gemini client is a singleton — initialized once and reused for all requests
 * to avoid repeated SDK instantiation overhead.
 *
 * @see {@link https://ai.google.dev/gemini-api/docs Google Gemini Developer API}
 * @see {@link https://cloud.google.com/vertex-ai/docs Vertex AI documentation}
 * @module utils/ai
 */

const { log } = require('./logger');

/** @type {import('@google/genai').GoogleGenAI|null} */
let _genAIClient = null;

/**
 * Send a prompt to Google Gemini / Vertex AI and return the generated text
 * along with token usage metadata for observability.
 *
 * @param {string} prompt - Fully constructed prompt string to send.
 * @returns {Promise<{text: string, promptTokens: number, outputTokens: number, totalTokens: number}>}
 * @throws {Error} If the AI service is unreachable or returns an unrecoverable error.
 */
async function getAIResponse(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const project = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0486189266';

  if (apiKey) {
    // ── Path 1: Gemini Developer API ─────────────────────────────────────────
    const { GoogleGenAI } = require('@google/genai');
    if (!_genAIClient) {
      _genAIClient = new GoogleGenAI({ apiKey });
      log('INFO', 'Gemini Developer API client initialized.', { model: 'gemini-2.5-flash' });
    }

    const response = await _genAIClient.models.generateContent({
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

  // ── Path 2: Vertex AI with Application Default Credentials ─────────────────
  const { VertexAI } = require('@google-cloud/vertexai');
  const vertex = new VertexAI({ project, location: 'us-central1' });
  const model = vertex.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

  log('INFO', 'Using Vertex AI with ADC.', { project, model: 'gemini-2.0-flash-001' });

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

module.exports = { getAIResponse };
