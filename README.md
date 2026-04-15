# LogicFlow: Code Review Assistant 🤖

**PromptWars Virtual Submission**

LogicFlow is an AI-powered, context-aware Code Review Assistant designed to help developers review code, debug issues, and architect systems — all through a conversational interface powered by **Google Gemini 2.5 Flash** with real-time **Google Search Grounding**.

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

## ☁️ Google Services Used

| Google Service | Role in LogicFlow |
|---|---|
| **Google Gemini 2.5 Flash** | Primary AI model for code review and developer assistance |
| **Gemini 2.0 Flash (Vertex AI)** | Fallback AI model via Application Default Credentials on Cloud Run |
| **Google Cloud Run** | Serverless container hosting with auto-scaling (0 → N instances) |
| **Google Cloud Logging** | Structured JSON logs compatible with Cloud Logging severity levels |
| **Google Search Grounding** | Real-time web search grounding to prevent AI hallucination |
| **Vertex AI** | Enterprise AI platform used for ADC-authenticated AI requests |

---

## 💡 Approach & Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Browser (Vanilla HTML/CSS/JS)                             │
│  ├── Glassmorphism UI with dark-mode design                │
│  ├── Markdown rendering (marked.js + highlight.js)         │
│  ├── Session persistence (localStorage)                    │
│  ├── Sidebar: Recent Chats, Tasks, Agent Log               │
│  └── WCAG 2.1 AA accessible (skip-nav, ARIA, reduced motion)│
└──────────────────────┬─────────────────────────────────────┘
                       │ POST /api/chat
┌──────────────────────▼─────────────────────────────────────┐
│  Express.js Server (Node 20)                               │
│  ├── Security: Helmet CSP, CORS, rate limiting, XSS guard  │
│  ├── AppError class: clean HTTP error propagation          │
│  ├── Performance: gzip compression, static caching         │
│  ├── Structured JSON logging (Cloud Logging compatible)    │
│  └── Graceful shutdown (SIGTERM + SIGINT handling)         │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  Google AI Services                                        │
│  ├── Gemini 2.5 Flash (Developer API) + Search Grounding   │
│  └── Vertex AI Gemini 2.0 Flash (Cloud Run ADC fallback)   │
└────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Zero-Framework Frontend** — Vanilla HTML/CSS/JS keeps the payload under 50 KB while delivering a premium glassmorphism UI with micro-animations.
2. **Dual AI Backend** — Supports both API-key and ADC authentication, automatically selecting the right path based on environment.
3. **Google Search Grounding** — Prevents hallucinations by grounding AI responses with live web search results.
4. **Defence-in-Depth Security** — Tuned CSP headers, HTML entity sanitization (display only), XSS content filtering, rate limiting, body size limits, and Content-Type validation.
5. **Raw Prompt Integrity** — User messages are passed raw to the AI (not HTML-escaped) to preserve natural language and code semantics. Sanitization is applied only to log entries and display text.

---

## 🛡️ Security Measures

| Layer | Implementation |
|---|---|
| **Content Security Policy** | Strict CSP: `default-src 'self'`, no `unsafe-eval`, approved CDN allowlist |
| **HTTP Headers** | `helmet` sets X-Content-Type-Options, X-Frame-Options (SAMEORIGIN), HSTS |
| **XSS Content Filter** | `isSafeForPrompt()` blocks `<script>` and `javascript:` injection in user input |
| **Input Sanitization** | Server-side HTML entity escaping for log entries and error display text |
| **Rate Limiting** | 50 requests per 15 min per IP via `express-rate-limit` |
| **Body Size Limits** | 50 KB JSON body limit; 5,000 char message limit; 50,000 char code limit |
| **Content-Type Validation** | Rejects non-JSON requests with HTTP 415 status |
| **Container Security** | Non-root user (`USER node`) in Docker; multi-stage builds for minimal attack surface |
| **Structured Error Handling** | `AppError` class provides clean HTTP status propagation without leaking internals |

---

## ♿ Accessibility (WCAG 2.1 AA)

- **Skip Navigation** link for keyboard users
- **ARIA landmarks** (`role="main"`, `role="complementary"`, `role="log"`)
- **Live regions** (`aria-live="polite"`, `aria-live="assertive"`) for dynamic chat updates
- **Screen reader announcements** for all user actions
- **Keyboard shortcuts** — `Ctrl+/` to focus input, `Escape` to close sidebar
- **Focus-visible indicators** with high-contrast outlines
- **`prefers-reduced-motion`** media query disables animations for sensitive users
- **Semantic HTML5** with proper heading hierarchy (`<h1>` → `<h3>`)
- **`<label>` + `aria-describedby`** on all form inputs
- **`aria-expanded`** on sidebar toggle button (dynamic state)

---

## 🧪 Automated Testing

LogicFlow uses the native `node:test` runner for zero-dependency, production-grade testing:

```bash
npm test
```

### Test Coverage (~55 tests)

| Category | Tests |
|---|---|
| **Unit: sanitizeInput()** | XSS, ampersands, quotes, non-string types, edge cases, long strings |
| **Unit: isSafeForPrompt()** | Script injection, javascript: URI, empty string, natural code |
| **Unit: AppError** | Status codes, message, inheritance, name property |
| **Input Validation** | Missing/wrong type message, length limits, oversized code, XSS rejection |
| **Content-Type** | text/plain, multipart, form-urlencoded rejection |
| **Security Headers** | CSP presence, no unsafe-eval, X-Content-Type-Options, clickjacking protection |
| **Cache Control** | no-store on AI API responses |
| **Integration** | Health check, /api/version, static file serving, 404 handling |
| **Accessibility** | ARIA landmarks, aria-live, aria-label, semantic elements |
| **E2E** | Full Gemini AI round-trip with stats validation |

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
- The Content Security Policy is tuned for the specific CDN assets used (Google Fonts, cdnjs) rather than being disabled (`contentSecurityPolicy: false`).

---

*Built with Google Gemini, Vertex AI, Google Cloud Run, and Cloud Logging for PromptWars Virtual.*
