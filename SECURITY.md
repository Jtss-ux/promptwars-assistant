# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅ Active  |

## Reporting a Vulnerability

If you discover a security vulnerability in LogicFlow, please **do not** open a public GitHub issue.

Instead, please report it by emailing the project maintainer privately. Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any suggested mitigations or patches

We aim to acknowledge all reports within 48 hours and provide a detailed response within 7 days.

---

## Security Architecture

LogicFlow implements multiple layers of defence-in-depth security:

### 1. HTTP Security Headers (Helmet.js)

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `default-src 'self'` | Prevents XSS, data injection |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing attacks |
| `X-Frame-Options` | `SAMEORIGIN` | Prevents clickjacking |
| `Strict-Transport-Security` | Enabled | Forces HTTPS connections |
| `X-DNS-Prefetch-Control` | `off` | Prevents DNS prefetch leaks |

### 2. Input Validation & Sanitization

- **Content-Type enforcement**: Only `application/json` is accepted (HTTP 415 for others)
- **Type checking**: `message` must be a `string`; numeric, boolean, array, and null types are rejected (HTTP 400)
- **Length limits**: 5,000 chars for user messages; 50,000 chars for code attachments
- **XSS content filter**: `isSafeForPrompt()` blocks `<script>` tags and `javascript:` URI schemes
- **HTML entity escaping**: `sanitizeInput()` applied to log entries and display text

### 3. Rate Limiting

- **50 requests per IP** per 15-minute sliding window
- Implemented with `express-rate-limit`
- Returns RFC 7807-compatible error JSON with `Retry-After` semantics

### 4. Container Security

- **Non-root user**: Docker container runs as `node` user (UID 1000), not root
- **Multi-stage build**: Production image contains only runtime dependencies
- **No secrets in image**: Credentials injected via environment variables or Cloud Run secrets

### 5. AI Prompt Integrity

- Raw (un-escaped) user messages are sent to Gemini to preserve natural language
- HTML sanitization is applied **only** to log entries and error display text
- This prevents entity re-encoding bugs (`&amp;lt;` → rendered as `&lt;` in AI) that degrade response quality

### 6. Dependency Security

- Dependencies are audited with `npm audit` in the CI pipeline
- Production images use `--production` flag (no dev dependencies)
- `node_modules` and `package-lock.json` are excluded from the repository via `.gitignore`

---

## Google Cloud Run Security

When deployed on Cloud Run:

- Service runs in a managed sandbox with automatic isolation
- Credentials use **Application Default Credentials (ADC)** — no hardcoded API keys in production
- Cloud Run enforces TLS 1.2+ on all inbound traffic
- Secret Manager integration for sensitive environment variables (`GEMINI_API_KEY`)
