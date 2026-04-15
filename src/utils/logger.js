'use strict';

/**
 * @fileoverview Structured JSON logger compatible with Google Cloud Logging.
 *
 * Outputs log entries in the format expected by Cloud Logging's structured
 * logging agent. Each entry includes severity, message, timestamp, and
 * optional labels and HTTP request metadata for log correlation.
 *
 * @see {@link https://cloud.google.com/logging/docs/structured-logging}
 */

const SERVICE_LABEL = { 'logging.googleapis.com/labels': { service: 'logicflow-assistant' } };

/**
 * Emit a structured JSON log entry to stdout (picked up by Cloud Logging).
 *
 * @param {'DEBUG'|'INFO'|'WARNING'|'ERROR'} severity - Log severity level.
 * @param {string} message - Human-readable log message.
 * @param {Object} [data={}] - Additional structured fields.
 * @param {Object} [httpRequest=null] - Optional Cloud Logging httpRequest fields.
 */
function log(severity, message, data = {}, httpRequest = null) {
  const entry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...SERVICE_LABEL,
    ...data,
  };
  if (httpRequest) {
    entry.httpRequest = httpRequest;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

module.exports = { log };
