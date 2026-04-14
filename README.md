# LogicFlow: Code Review Assistant 🤖

**PromptWars Virtual Submission**

LogicFlow is an AI-powered, context-aware Code Review Assistant designed to help developers review code, debug issues, and architect systems — all through a conversational interface powered by Google Gemini 2.5 Flash with real-time Google Search grounding.

---

## 🚀 The Vertical: Developer Productivity & Mentorship

LogicFlow targets the **Developer Productivity** vertical with an "Expert AI Developer" persona that adapts its behavior based on the user's selected execution context:

| Context | Behavior |
|---|---|
| **General Developer Support** | Answers broad coding questions concisely |
| **Code Review & Optimization** | Deep-dives into code quality, performance, and best practices |
| **System Architecture Design** | Provides architecture patterns, SOLID principles, and scalability advice |
| **Debugging & Error Resolution** | Systematic debugging strategies with structured logging guidance |

---

## 💡 Approach & Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Vanilla HTML/CSS/JS)                             │
│  ├── Glassmorphism UI with dark-mode design                │
│  ├── Markdown rendering (marked.js + highlight.js)         │
│  ├── Session persistence (localStorage)                    │
│  └── WCAG 2.1 AA accessible (skip-nav, ARIA, reduced motion) │
└──────────────────────┬─────────────────────────────────────┘
                       │ POST /api/chat
┌──────────────────────▼─────────────────────────────────────┐
│  Express.js Server (Node 20)                               │
│  ├── Security: helmet, CORS, rate limiting, input sanitize │
│  ├── Performance: gzip compression, static caching         │
│  ├── Structured JSON logging (Cloud Logging compatible)    │
│  └── Graceful shutdown (SIGTERM handling)                   │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  Google AI Services                                        │
│  ├── Gemini 2.5 Flash (Developer API) with Search Grounding│
│  └── Vertex AI (Cloud Run ADC fallback)                    │
└────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Zero-Framework Frontend** — Vanilla HTML/CSS/JS keeps the payload under 50 KB while delivering a premium glassmorphism UI with micro-animations.
2. **Dual AI Backend** — Supports both API-key and ADC authentication, automatically selecting the right path based on environment.
3. **Google Search Grounding** — Prevents hallucinations by grounding AI responses with live web search results.
4. **Defence-in-Depth Security** — Helmet headers, HTML entity sanitization, rate limiting, body size limits, and Content-Type validation.

---

## 🛡️ Security Measures

| Layer | Implementation |
|---|---|
| HTTP Headers | `helmet` sets X-Content-Type-Options, X-Frame-Options, HSTS, etc. |
| Input Sanitization | Server-side HTML entity escaping (`<`, `>`, `"`, `'`, `&`) prevents XSS |
| Rate Limiting | 50 requests per 15 min per IP via `express-rate-limit` |
| Body Size Limits | 50 KB JSON body limit; 5,000 char message limit; 50,000 char code limit |
| Content-Type Validation | Rejects non-JSON requests with 415 status |
| Container Security | Non-root user (`USER node`) in Docker; multi-stage builds |

---

## ♿ Accessibility (WCAG 2.1 AA)

- **Skip Navigation** link for keyboard users
- **ARIA landmarks** (`role="main"`, `role="complementary"`, `role="log"`)
- **Live regions** (`aria-live="polite"`) for dynamic chat updates
- **Screen reader announcements** for all user actions
- **Keyboard shortcuts** — `Ctrl+/` to focus input, `Escape` to close sidebar
- **Focus-visible indicators** with high-contrast outlines
- **`prefers-reduced-motion`** media query disables animations for sensitive users
- **Semantic HTML5** with proper heading hierarchy (`<h1>` → `<h3>`)

---

## 🧪 Automated Testing

LogicFlow uses the native `node:test` runner for zero-dependency testing:

```bash
npm test
```

### Test Coverage

| Category | Tests |
|---|---|
| **Unit** | `sanitizeInput()` — XSS, ampersands, quotes, edge cases, non-string types |
| **Validation** | Missing message, non-string types, length limits, oversized code, Content-Type |
| **Security** | Helmet headers presence verification |
| **Integration** | Health check endpoint, static file serving |
| **E2E** | Full AI round-trip with Gemini response validation |

---

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Create .env file
echo "GEMINI_API_KEY=your_key_here" > .env

# Start development server
npm run dev

# Run tests
npm test
```

---

## 🐳 Docker & Cloud Run Deployment

```bash
# Build container
docker build -t logicflow .

# Run locally
docker run -p 8080:8080 -e GEMINI_API_KEY=your_key logicflow

# Deploy to Cloud Run
gcloud run deploy logicflow \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets=GEMINI_API_KEY=gemini-key:latest
```

---

## 📝 Assumptions

- The user requires instant visual feedback with minimal interaction friction.
- The assistant operates as a standalone service designed for Google Cloud Run.
- Cloud Run provides seamless scaling and authentication handling for Google Services via ADC without hardcoded credentials.

---

*Built with Google Gemini, Vertex AI, and Cloud Run for PromptWars Virtual.*
