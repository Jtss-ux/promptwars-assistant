'use strict';

/**
 * @fileoverview In-memory response cache with TTL and LRU eviction.
 *
 * Avoids redundant round-trips to the Gemini API for identical prompts
 * within the TTL window. Entries expire after 5 minutes; the cache is
 * capped at 100 entries to prevent unbounded memory growth.
 */

/** @type {Map<string, {reply: string, stats: Object, timestamp: number}>} */
const responseCache = new Map();

/** Cache entry time-to-live: 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of cached entries before oldest entries are evicted. */
const MAX_CACHE_ENTRIES = 100;

/**
 * Generate a normalized cache key from context and message.
 * Only short messages (≤200 chars) are cached to avoid storing large payloads.
 *
 * @param {string} context - Execution context.
 * @param {string} message - User message.
 * @returns {string|null} Cache key, or null if response should not be cached.
 */
function getCacheKey(context, message) {
  if (!message || message.length > 200) {return null;}
  return `${context}::${message.trim().toLowerCase()}`;
}

/**
 * Purge expired cache entries and enforce the MAX_CACHE_ENTRIES limit.
 */
function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      responseCache.delete(key);
    }
  }
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
}

/**
 * Get a cached entry if it exists and has not expired.
 *
 * @param {string} key - Cache key from {@link getCacheKey}.
 * @returns {{ reply: string, stats: Object }|null} Cached data or null.
 */
function getCache(key) {
  if (!key) {return null;}
  const entry = responseCache.get(key);
  if (!entry) {return null;}
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return { reply: entry.reply, stats: entry.stats };
}

/**
 * Store a response in the cache and trigger eviction.
 *
 * @param {string} key   - Cache key from {@link getCacheKey}.
 * @param {string} reply - AI reply text.
 * @param {Object} stats - Response statistics object.
 */
function setCache(key, reply, stats) {
  if (!key) {return;}
  responseCache.set(key, { reply, stats, timestamp: Date.now() });
  pruneCache();
}

/** Total number of entries currently in the cache. */
function cacheSize() {
  return responseCache.size;
}

module.exports = { getCacheKey, getCache, setCache, cacheSize, CACHE_TTL_MS, MAX_CACHE_ENTRIES };
