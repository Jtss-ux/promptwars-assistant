# Contributing to LogicFlow: Code Review Assistant

Thank you for your interest in contributing! This guide outlines how to get started.

## Prerequisites

- Node.js ≥ 18
- A Google Gemini API key ([get one here](https://aistudio.google.com/app/apikey))
- Git

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/Jtss-ux/logicflow-assistant.git
cd logicflow-assistant

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Add your GEMINI_API_KEY to .env

# 4. Start the development server
npm run dev
# → http://localhost:8080
```

## Running Tests

```bash
# Full test suite (88 tests)
npm test

# Watch mode
npm run test:watch
```

All 88 tests must pass before submitting a PR.

## Linting

```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix where possible
```

## Project Structure

```
logicflow-assistant/
├── server.js              # Express app entry point
├── src/
│   ├── middleware/
│   │   └── security.js    # Helmet, CORS, and rate limiting
│   ├── routes/
│   │   ├── chat.js        # POST /api/chat router (AI integration)
│   │   └── health.js      # GET /health & /api/version routes
│   └── utils/
│       ├── ai.js          # Gemini & Vertex AI client abstraction
│       ├── cache.js       # In-memory response cache (TTL + LRU)
│       ├── firestore.js   # Google Cloud Firestore integration
│       ├── logger.js      # Cloud Logging-compatible structured logger
│       ├── metrics.js     # Google Cloud Monitoring custom metrics
│       ├── sanitize.js    # Input sanitisation & prompt safety
│       └── secrets.js     # Google Cloud Secret Manager integration
├── public/
│   ├── index.html         # Frontend UI
│   ├── style.css          # Styles
│   └── app.js             # Frontend JavaScript
├── app.test.js            # Full test suite (Node.js built-in test runner)
├── .env.example           # Environment variable reference
├── .eslintrc.json         # ESLint configuration
├── SECURITY.md            # Vulnerability disclosure policy
└── Dockerfile             # Container definition for Cloud Run
```

## Code Style Guidelines

- Use `'use strict'` in all modules
- JSDoc comments on all exported functions
- No `console.log` — use the structured `log()` function in `server.js` or `src/utils/logger.js`
- Prefer `async/await` over callbacks
- Always handle errors with `AppError` and appropriate HTTP status codes

## Pull Request Checklist

- [ ] All 88 tests pass (`npm test`)
- [ ] Lint is clean (`npm run lint`)
- [ ] New features include tests
- [ ] JSDoc added for new public functions
- [ ] `.env.example` updated if new env vars are added

## Google Services Integration

When adding new Google Cloud integrations:
1. Add the SDK to `dependencies` in `package.json`
2. Create a dedicated module in `src/utils/`
3. Use lazy initialisation with graceful degradation (no crashes if unavailable)
4. Add the service name to the `googleServices` array in `GET /api/version`
5. Update `CONTRIBUTING.md` and `docs/ARCHITECTURE.md`
