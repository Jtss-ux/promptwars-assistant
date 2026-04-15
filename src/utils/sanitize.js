'use strict';

/**
 * @fileoverview Input sanitization and prompt-safety utilities.
 * Applied server-side as defence-in-depth against XSS and prompt injection.
 */

/**
 * Sanitize user input by escaping HTML entities.
 * NOTE: Never pass sanitized strings to the AI prompt — HTML entities
 * degrade response quality. Use raw strings for AI; sanitize only for logs.
 *
 * @param {string} str - Raw user input.
 * @returns {string} HTML-entity-escaped string.
 */
function sanitizeInput(str) {
  if (typeof str !== 'string') {return '';}
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Determine whether a user message is safe to include in an AI prompt.
 * Blocks `<script>` tags and `javascript:` URIs to prevent prompt injection.
 *
 * @param {string} message - Raw user message.
 * @returns {boolean} True if the message is safe for the AI prompt.
 */
function isSafeForPrompt(message) {
  if (typeof message !== 'string') {return false;}
  const lower = message.toLowerCase();
  if (/<script[\s>]/i.test(message)) {return false;}
  if (lower.includes('javascript:')) {return false;}
  return true;
}

module.exports = { sanitizeInput, isSafeForPrompt };
