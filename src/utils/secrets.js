'use strict';

/**
 * @fileoverview Google Cloud Secret Manager integration.
 *
 * Provides a secure way to retrieve API keys and secrets from
 * Google Cloud Secret Manager instead of environment variables.
 * Falls back to environment variables gracefully for local development.
 *
 * Benefits over plain env vars:
 *  - Secrets are never committed to source control
 *  - Automatic rotation support
 *  - Audit logging via Cloud Audit Logs
 *  - Fine-grained IAM access control
 *
 * @see {@link https://cloud.google.com/secret-manager/docs}
 * @module utils/secrets
 */

const { log } = require('./logger');

/** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient|null} */
let _client = null;
let _initialized = false;

/**
 * Lazily initialize the Secret Manager client.
 * Returns null if the SDK is not installed or ADC is unavailable.
 *
 * @returns {import('@google-cloud/secret-manager').SecretManagerServiceClient|null}
 */
function getClient() {
  if (_initialized) {return _client;}
  _initialized = true;

  try {
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    _client = new SecretManagerServiceClient();
    log('INFO', 'Secret Manager client initialized.', { service: 'secret-manager' });
  } catch {
    log('DEBUG', 'Secret Manager SDK not available — using env vars for secrets.');
    _client = null;
  }

  return _client;
}

/**
 * Retrieve the latest version of a secret from Google Cloud Secret Manager.
 * Falls back to the provided environment variable value if Secret Manager
 * is unavailable or the secret does not exist.
 *
 * @param {string} secretName  - Full secret resource name.
 *                               Format: `projects/{project}/secrets/{name}/versions/latest`
 * @param {string} [envFallback] - Fallback value (e.g. from process.env).
 * @returns {Promise<string|null>} Secret value, or fallback, or null.
 *
 * @example
 * const key = await getSecret(
 *   `projects/${PROJECT_ID}/secrets/gemini-api-key/versions/latest`,
 *   process.env.GEMINI_API_KEY,
 * );
 */
async function getSecret(secretName, envFallback = null) {
  // Prefer Secret Manager in production
  const client = getClient();
  if (client && secretName) {
    try {
      const [version] = await client.accessSecretVersion({ name: secretName });
      const payload = version.payload?.data?.toString('utf8');
      if (payload) {
        log('DEBUG', 'Secret retrieved from Secret Manager.', { secret: secretName.split('/').pop() });
        return payload.trim();
      }
    } catch (err) {
      log('DEBUG', 'Secret Manager lookup failed — falling back to env var.', {
        secret: secretName.split('/').pop(),
        reason: err.message,
      });
    }
  }

  // Fall back to provided value (environment variable)
  return envFallback || null;
}

module.exports = { getSecret };
