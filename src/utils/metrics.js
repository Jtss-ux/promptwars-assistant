'use strict';

/**
 * @fileoverview Google Cloud Monitoring (formerly Stackdriver) custom metrics.
 *
 * Records application-level metrics to Cloud Monitoring for observability:
 *  - logicflow/chat_requests_total  — total AI chat requests
 *  - logicflow/cache_hits_total     — cache hit count
 *  - logicflow/ai_latency_ms        — AI response latency distribution
 *
 * The metrics client is initialized lazily and fails gracefully — metric
 * recording errors never affect the chat endpoint response.
 *
 * @see {@link https://cloud.google.com/monitoring/custom-metrics}
 * @see {@link https://cloud.google.com/nodejs/docs/reference/monitoring/latest}
 * @module utils/metrics
 */

const { log } = require('./logger');

/** @type {import('@google-cloud/monitoring').MetricServiceClient|null} */
let _client = null;
let _initialized = false;

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';

/**
 * Lazily initialize the Cloud Monitoring client.
 * Returns null if the SDK is not installed or credentials are unavailable.
 *
 * @returns {import('@google-cloud/monitoring').MetricServiceClient|null}
 */
function getClient() {
  if (_initialized) return _client;
  _initialized = true;

  try {
    const monitoring = require('@google-cloud/monitoring');
    _client = new monitoring.MetricServiceClient();
    log('INFO', 'Cloud Monitoring client initialized.', { service: 'cloud-monitoring' });
  } catch {
    log('DEBUG', 'Cloud Monitoring SDK not available — metrics disabled.');
    _client = null;
  }

  return _client;
}

/**
 * Write a single integer gauge metric to Cloud Monitoring.
 * Failures are caught and logged; never propagated to callers.
 *
 * @param {string} metricType - Custom metric type (e.g. 'logicflow/chat_requests_total').
 * @param {number} value      - Metric value.
 * @param {Object} [labels]   - Optional label key/value pairs.
 * @returns {Promise<void>}
 */
async function writeMetric(metricType, value, labels = {}) {
  if (!PROJECT_ID) return; // Can't write without a project
  const client = getClient();
  if (!client) return;

  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const nanos = (now % 1000) * 1e6;

  const timeSeries = [{
    metric: {
      type: `custom.googleapis.com/${metricType}`,
      labels,
    },
    resource: {
      type: 'global',
      labels: { project_id: PROJECT_ID },
    },
    points: [{
      interval: { endTime: { seconds, nanos } },
      value: { int64Value: value },
    }],
  }];

  try {
    await client.createTimeSeries({
      name: client.projectPath(PROJECT_ID),
      timeSeries,
    });
  } catch (err) {
    log('DEBUG', 'Cloud Monitoring metric write failed.', {
      metric: metricType,
      error: err.message,
    });
  }
}

/**
 * Increment the chat request counter metric.
 * @param {{ cached: boolean, context: string }} opts
 */
async function recordChatRequest({ cached = false, context = 'unknown' } = {}) {
  await writeMetric('logicflow/chat_requests_total', 1, {
    cached: String(cached),
    context: context.slice(0, 64),
  });
}

/**
 * Record AI response latency.
 * @param {number} elapsedMs - Elapsed milliseconds.
 */
async function recordAiLatency(elapsedMs) {
  await writeMetric('logicflow/ai_latency_ms', Math.round(elapsedMs));
}

module.exports = { recordChatRequest, recordAiLatency };
