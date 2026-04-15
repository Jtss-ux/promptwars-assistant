# LogicFlow: Code Review Assistant

<div align="center">

[![Tests](https://img.shields.io/badge/tests-88%20passing-brightgreen?style=for-the-badge&logo=node.js)](./app.test.js)
[![Google Cloud](https://img.shields.io/badge/Google%20Cloud-8%20Services-4285F4?style=for-the-badge&logo=google-cloud)](./docs/ARCHITECTURE.md)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-43853d?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](./LICENSE)
[![Cloud Run](https://img.shields.io/badge/Cloud%20Run-Deployed-4285F4?style=for-the-badge&logo=google-cloud)](https://logicflow-513799679220.us-central1.run.app/)

**An AI-powered code review assistant that provides context-aware feedback, architectural guidance, and real-time debugging support — powered by Google Gemini and 8 Google Cloud services.**

[🚀 Live Demo](https://logicflow-513799679220.us-central1.run.app/) · [📖 Architecture](./docs/ARCHITECTURE.md) · [🤝 Contributing](./CONTRIBUTING.md)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🤖 **AI Code Review** | Context-aware reviews using Google Gemini 2.5 Flash |
| 🔍 **GitHub Integration** | Paste any GitHub file URL for direct code analysis |
| 💾 **Smart Caching** | 5-minute in-memory cache with LRU eviction (X-Cache header) |
| 📊 **Conversation History** | Persistent storage via Google Cloud Firestore |
| 🔒 **Secure by Default** | Helmet CSP, rate limiting, input validation, Secret Manager |
| 📈 **Observability** | Cloud Logging + Cloud Monitoring custom metrics |
| ♿ **Accessible** | WCAG 2.1 AA — ARIA landmarks, skip links, live regions |
| ⚡ **Fast** | Gzip compression, static caching, X-Response-Time header |

## 🏗️ Architecture

```
Browser → Google Cloud Run → [ Gemini API / Vertex AI ]
                          → Google Cloud Firestore (conversation history)
                          → Google Cloud Monitoring (custom metrics)
                          → Google Cloud Logging (structured logs)
                          → Google Secret Manager (API keys)
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full system diagram.

## 🔧 Google Cloud Services

| # | Service | Purpose |
|---|---|---|
| 1 | **Google Gemini (gemini-2.5-flash)** | Primary AI inference with Search Grounding |
| 2 | **Vertex AI (gemini-2.0-flash)** | Fallback with Application Default Credentials |
| 3 | **Google Cloud Run** | Auto-scaling serverless container host |
| 4 | **Google Cloud Logging** | Structured JSON log ingestion (severity, labels, httpRequest) |
| 5 | **Google Search Grounding** | Real-time web-grounded AI responses |
| 6 | **Google Cloud Firestore** | Conversation turn persistence & analytics |
| 7 | **Google Cloud Secret Manager** | Secure API key retrieval (no plaintext in env) |
| 8 | **Google Cloud Monitoring** | Custom metrics: `chat_requests_total`, `ai_latency_ms` |

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

### Local Development

```bash
# Clone
git clone https://github.com/Jtss-ux/promptwars-assistant.git
cd promptwars-assistant

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# → Add your GEMINI_API_KEY to .env

# Start dev server
npm run dev
# → http://localhost:8080
```

### Running Tests

```bash
npm test                 # 88 tests, 0 failures
npm run test:coverage    # With coverage report
npm run lint             # ESLint (security rules)
```

## 📁 Project Structure

```
logicflow-assistant/
├── server.js                  # Express app entry point (all middleware + routes)
├── app.test.js                # 88-test suite (Node.js native test runner)
│
├── src/
│   └── utils/
│       ├── cache.js           # In-memory response cache (TTL + LRU eviction)
│       ├── firestore.js       # 🔵 Google Cloud Firestore integration
│       ├── logger.js          # 🔵 Cloud Logging structured logger
│       ├── metrics.js         # 🔵 Cloud Monitoring custom metrics
│       ├── sanitize.js        # Input sanitisation & prompt-safety guards
│       └── secrets.js         # 🔵 Google Cloud Secret Manager integration
│
├── public/
│   ├── index.html             # Frontend UI (semantic HTML5 + ARIA)
│   ├── style.css              # Glassmorphism dark-mode design system
│   ├── app.js                 # Frontend JavaScript (fetch, rendering)
│   └── manifest.json          # PWA web app manifest
│
├── docs/
│   └── ARCHITECTURE.md        # System diagram + Google Services table
│
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions CI (lint + test on push/PR)
│
├── .env.example               # Environment variable reference
├── .eslintrc.json             # ESLint (security-focused rules)
├── CONTRIBUTING.md            # Developer guide
├── SECURITY.md                # Vulnerability disclosure policy
└── Dockerfile                 # Cloud Run container definition
```

## 🛡️ Security

- **Helmet.js** — CSP, HSTS, X-Content-Type-Options, X-Frame-Options
- **Rate Limiting** — 50 req / IP / 15 min on `/api/chat`
- **Input Validation** — XSS pattern detection (`isSafeForPrompt`), HTML entity escaping
- **Body Size Cap** — 50 KB max JSON payloads
- **Secret Manager** — Optional secure API key retrieval (no plaintext in environment)
- **Content-Type Enforcement** — Only `application/json` accepted on API routes

See [SECURITY.md](./SECURITY.md) for the full vulnerability disclosure policy.

## 📊 API Reference

### `POST /api/chat`

Send a developer query with optional context and code snippet.

**Request:**
```json
{
  "message": "How can I optimise this function?",
  "context": "Code Review & Optimization",
  "githubCode": "def slow_fn(arr):\n  return [x for x in arr if x > 0]"
}
```

**Response:**
```json
{
  "reply": "## Code Review\n\nYour function looks clean...",
  "stats": {
    "elapsed": "1.23",
    "promptTokens": 142,
    "outputTokens": 318,
    "totalTokens": 460
  }
}
```

**Headers:** `X-Cache: HIT | MISS`, `X-Response-Time: 1230ms`, `Cache-Control: no-store`

### `GET /health`

Returns server status for Cloud Run health probes.

```json
{ "status": "ok", "ai": "gemini-api-key", "uptime": 3600, "node": "v24.0.0" }
```

### `GET /api/version`

Returns app metadata including all active Google Services.

```json
{
  "name": "logicflow-code-review-assistant",
  "version": "1.0.0",
  "googleServices": ["Google Gemini...", "Vertex AI...", "...8 total"],
  "cacheEntries": 5
}
```

## ♿ Accessibility

- Semantic HTML5 (`<header>`, `<main>`, `<aside>`, `<footer>`)
- ARIA landmarks: `role="main"`, `role="complementary"`, `role="search"`
- ARIA live region for AI response announcements
- Skip-to-content link for keyboard users
- `aria-label` on all interactive elements
- `lang="en"` on `<html>` element
- Keyboard-navigable interface

## 🧪 Test Coverage

```
Test Suites: 7 total
Tests:       88 passed, 0 failed

├── Unit Tests: sanitizeInput()          — 9 tests
├── Unit Tests: isSafeForPrompt()        — 6 tests
├── Unit Tests: AppError class           — 4 tests
├── Unit Tests: Cache Module             — 10 tests
├── Unit Tests: Sanitize Module          — 7 tests
├── API Validation & Integration Tests   — 44 tests
└── Integration Tests: /api/version      — 8 tests
```

## 🌐 Deployment

The app is deployed on **Google Cloud Run** — fully managed, auto-scaling, and stateless.

```bash
# Build and deploy to Cloud Run
gcloud run deploy logicflow-assistant \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your_key
```

**Live URL:** https://logicflow-513799679220.us-central1.run.app/

## 📓 Chosen Vertical

**Developer Tools** — This solution addresses one of the most common pain points in software development: slow, inconsistent code review. LogicFlow provides instant, context-aware feedback in three modes:

1. **Code Review & Optimization** — Identifies performance bottlenecks, anti-patterns, and style issues
2. **System Architecture Design** — Reviews architectural decisions against SOLID principles and cloud-native patterns
3. **Debugging & Error Resolution** — Structured root-cause analysis with step-by-step debugging strategies

### Approach & Logic

1. User selects their **context** (Code Review / Architecture / Debugging)
2. Message + optional code paste → server validates and sanitizes input
3. Context-specific **system prompt** is constructed and sent to Gemini
4. Response is checked against the **in-memory cache** (5-min TTL) before hitting the API
5. Conversation turn is **persisted to Firestore** asynchronously (never blocks response)
6. **Custom metrics** are written to Cloud Monitoring for observability
7. AI response is streamed back as Markdown and rendered in the chat UI

### Assumptions

- Gemini free-tier quota is sufficient for demo; production uses Vertex AI with ADC
- Firestore + Secret Manager availability is optional — the app degrades gracefully
- The in-memory cache is process-scoped; a Redis layer would be used in multi-instance production

## 📄 License

[MIT](./LICENSE) © LogicFlow Team
