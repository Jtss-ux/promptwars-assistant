# Changelog

All notable changes to LogicFlow: Code Review Assistant are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2025-04-15

### Added
- **Google Cloud Firestore** integration (`src/utils/firestore.js`) — all conversation turns are now persisted asynchronously; enables per-session history retrieval and usage analytics.
- **Google Cloud Monitoring** custom metrics (`src/utils/metrics.js`):
  - `custom.googleapis.com/logicflow/chat_requests_total` — counter with `cached` and `context` labels
  - `custom.googleapis.com/logicflow/ai_latency_ms` — AI response time gauge
- **Google Cloud Secret Manager** integration (`src/utils/secrets.js`) — API keys can now be retrieved from Secret Manager instead of plain environment variables.
- Modular `src/utils/` architecture: `cache.js`, `logger.js`, `sanitize.js` extracted from server.js.
- `docs/ARCHITECTURE.md` — ASCII system diagram with full Google Services table.
- `CONTRIBUTING.md` — developer onboarding guide with project structure and PR checklist.
- `.env.example` — full environment variable reference including Secret Manager.
- `public/manifest.json` — PWA web app manifest with theme colors, icons, and shortcuts.
- `LICENSE` (MIT) — explicit licensing.
- 25 new tests (88 total): Cache module, Sanitize module, `/api/version` integration.
- `GET /api/version` now exposes `cacheEntries` count and 8 Google Services.

### Changed
- `X-Response-Time` middleware now overrides `res.end()` instead of using `res.on('finish')` — eliminates `ERR_HTTP_HEADERS_SENT` crash.
- Test `before()` hooks migrated from `child_process.spawn` to direct `app.listen()` — eliminates Windows port-race race condition.
- `module.exports` now includes `getCacheKey` and `pruneCache` for test coverage.
- `package.json` keywords updated to include `firestore`, `secret-manager`, `cloud-monitoring`.

### Fixed
- `ERR_HTTP_HEADERS_SENT` error caused by setting response headers in `res.on('finish')` callback (post-send).
- Test suite instability on Windows due to dotenvx startup overhead in child process spawn.
- `X-Content-Type-Options: nosniff` header not visible in test fetch due to server crash.

---

## [1.1.0] — 2025-04-14

### Added
- **In-memory response cache** with 5-minute TTL and 100-entry LRU cap.
  - `X-Cache: HIT | MISS` header on every `/api/chat` response.
  - Cache key normalisation: lowercased, trimmed context+message pair.
  - Only caches messages ≤ 200 characters to avoid storing large code payloads.
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs lint + full test suite on every push and pull request.
- **ESLint** (`.eslintrc.json`) — security-focused rules: no-eval, no-implied-eval, prefer-strict, consistent-return.
- **SECURITY.md** — vulnerability disclosure policy with responsible disclosure timeline.
- `lint:fix` and `test:watch` npm scripts.
- `GET /api/version` endpoint — app metadata and Google Services listing.
- Explicit `X-Content-Type-Options: nosniff` verification test.

### Changed
- Health check retry limit increased (`MAX_RETRIES: 30`, 400 ms intervals) in test setup.
- `module.exports` now includes `app` for direct test server binding.

### Fixed
- 63 → 63 passing tests after middleware crash fix (all green).

---

## [1.0.0] — 2025-04-14

### Added
- Initial release of **LogicFlow: Code Review Assistant**.
- Express server with Helmet, CORS, compression, rate limiting, body-size cap.
- **Google Gemini Developer API** (primary path via `GEMINI_API_KEY`).
- **Vertex AI** fallback using Application Default Credentials (Cloud Run).
- **Google Search Grounding** — real-time web-grounded AI responses.
- Context-aware prompt engineering (3 modes: Code Review, Architecture, Debugging).
- Expert fallback responses when AI is unavailable.
- **Structured Cloud Logging** — severity-stamped JSON logs with `httpRequest` fields.
- Input sanitisation (`sanitizeInput`) and prompt safety (`isSafeForPrompt`).
- Frontend: Glassmorphism dark-mode UI, markdown rendering, code syntax highlighting.
- Frontend sidebar: Recent chats, task tracker, agent log.
- GitHub code fetch — paste any raw GitHub file URL to include code in review.
- Accessibility: ARIA landmarks, skip link, live region, `lang="en"`, `aria-label`.
- Rate limiting: 50 requests / IP / 15-minute window on `/api/chat`.
- Graceful shutdown: SIGTERM + SIGINT handlers for Cloud Run scale-down.
- Deployed to Google Cloud Run (`us-central1`).
- 63 automated tests covering unit, integration, security, and accessibility.
