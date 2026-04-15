'use strict';

/**
 * @fileoverview Google Cloud Firestore integration for conversation history.
 *
 * Persists every AI-assisted conversation turn to Firestore, enabling:
 *  - Conversation history retrieval
 *  - Usage analytics
 *  - Audit logging
 *
 * The Firestore client is initialized lazily. If Firestore is unavailable
 * (e.g. missing credentials in local dev), logging is silently skipped so
 * the chat endpoint remains fully functional.
 *
 * Collection schema:
 *   conversations/{autoId}
 *     sessionId:   string    — client session identifier
 *     context:     string    — selected execution context
 *     userMessage: string    — sanitized user message (HTML-escaped)
 *     aiReply:     string    — AI-generated response
 *     tokens:      number    — total tokens consumed
 *     elapsedMs:   number    — server-side processing time
 *     timestamp:   Timestamp — Firestore server timestamp
 *     cached:      boolean   — true if response was served from cache
 *
 * @see {@link https://cloud.google.com/firestore/docs}
 * @module utils/firestore
 */

const { log } = require('./logger');

/** @type {import('@google-cloud/firestore').Firestore|null} */
let _db = null;

/** Whether Firestore initialization has been attempted. */
let _initialized = false;

/**
 * Lazily initialize and return the Firestore client.
 * Returns null if the SDK is not installed or credentials are unavailable.
 *
 * @returns {import('@google-cloud/firestore').Firestore|null}
 */
function getDb() {
  if (_initialized) {return _db;}
  _initialized = true;

  try {
    const { Firestore } = require('@google-cloud/firestore');
    _db = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    });
    log('INFO', 'Firestore client initialized.', { service: 'firestore' });
  } catch (err) {
    log('WARNING', 'Firestore unavailable — conversation history disabled.', {
      reason: err.message,
    });
    _db = null;
  }

  return _db;
}

/**
 * Save a completed conversation turn to Firestore.
 * Failures are caught and logged — never propagated to callers.
 *
 * @param {Object} turn
 * @param {string}  turn.sessionId    - Client session identifier.
 * @param {string}  turn.context      - Execution context (e.g. "Code Review").
 * @param {string}  turn.userMessage  - Raw user message (un-escaped for storage).
 * @param {string}  turn.aiReply      - AI-generated response text.
 * @param {number}  [turn.tokens]     - Total tokens consumed.
 * @param {number}  [turn.elapsedMs]  - Server processing time in ms.
 * @param {boolean} [turn.cached]     - True if response came from cache.
 * @returns {Promise<void>}
 */
async function saveConversationTurn(turn) {
  if (process.env.NODE_ENV === 'test') {return;}
  const db = getDb();
  if (!db) {return;}

  try {
    const { FieldValue } = require('@google-cloud/firestore');
    await db.collection('conversations').add({
      sessionId:   turn.sessionId || 'anonymous',
      context:     turn.context || 'General',
      userMessage: turn.userMessage || '',
      aiReply:     (turn.aiReply || '').slice(0, 2000), // cap at 2 KB per turn
      tokens:      turn.tokens || 0,
      elapsedMs:   turn.elapsedMs || 0,
      cached:      turn.cached || false,
      timestamp:   FieldValue.serverTimestamp(),
    });
    log('DEBUG', 'Conversation turn saved to Firestore.', {
      context: turn.context,
      cached: turn.cached,
    });
  } catch (err) {
    log('WARNING', 'Failed to save conversation turn to Firestore.', {
      error: err.message,
    });
  }
}

/**
 * Retrieve the most recent conversation turns for a given session.
 *
 * @param {string} sessionId - Session identifier.
 * @param {number} [limit=10] - Maximum number of turns to retrieve.
 * @returns {Promise<Array<Object>>} Array of turn objects, newest first.
 */
async function getConversationHistory(sessionId, limit = 10) {
  if (process.env.NODE_ENV === 'test') {return [];}
  const db = getDb();
  if (!db) {return [];}

  try {
    const snapshot = await db.collection('conversations')
      .where('sessionId', '==', sessionId)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    log('WARNING', 'Failed to retrieve conversation history.', { error: err.message });
    return [];
  }
}

module.exports = { saveConversationTurn, getConversationHistory };
