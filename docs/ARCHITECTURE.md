# Architecture — LogicFlow: Code Review Assistant

## Overview

LogicFlow is a context-aware AI code review assistant built on **Google Cloud**. It accepts a developer's question and optional code snippet, routes it through a prompt-engineered Gemini model, and returns a structured Markdown response.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
│   index.html + app.js + style.css  (served as static assets)   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS POST /api/chat
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│             Google Cloud Run  (us-central1)                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     server.js (Express)                  │   │
│  │                                                          │   │
│  │  Middleware stack (in order):                            │   │
│  │  1. Helmet  → security headers (CSP, HSTS, nosniff…)    │   │
│  │  2. CORS    → origin allowlist                           │   │
│  │  3. Compression → gzip/brotli                           │   │
│  │  4. JSON body-parser (50 KB cap)                         │   │
│  │  5. Static files  (public/, 1h cache, ETag)              │   │
│  │  6. Rate limiter  (50 req / 15 min / IP)                 │   │
│  │  7. X-Response-Time  (res.end() override)                │   │
│  │                                                          │   │
│  │  POST /api/chat flow:                                    │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ Validate Content-Type / body fields                │  │   │
│  │  │ isSafeForPrompt() → block XSS/injection           │  │   │
│  │  │ getCacheKey() → check in-memory cache              │  │   │
│  │  │   ├─ HIT  → return cached reply (X-Cache: HIT)    │  │   │
│  │  │   └─ MISS → call getAIResponse()                  │  │   │
│  │  │              ├─ Path1: Gemini Dev API (API key)   │  │   │
│  │  │              └─ Path2: Vertex AI (ADC)            │  │   │
│  │  │ Store reply in cache                               │  │   │
│  │  │ saveConversationTurn() → Firestore (async)        │  │   │
│  │  │ recordChatRequest()   → Cloud Monitoring (async)  │  │   │
│  │  │ recordAiLatency()     → Cloud Monitoring (async)  │  │   │
│  │  │ Return JSON response                               │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────┬───────────────────┬───────────────────┬─────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
  ┌─────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
  │  Google Gemini  │ │  Google Cloud    │ │  Google Cloud        │
  │  Developer API  │ │  Firestore       │ │  Monitoring          │
  │  (gemini-2.5-   │ │  (conversations  │ │  (custom metrics:    │
  │   flash)        │ │   collection)    │ │   chat_requests,     │
  │                 │ │                  │ │   ai_latency_ms)     │
  └─────────────────┘ └──────────────────┘ └──────────────────────┘
            │
            ▼
  ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐
  │  Vertex AI      │   │  Cloud Logging   │   │  Secret Manager  │
  │  (fallback ADC) │   │  (stdout JSON)   │   │  (API key store) │
  └─────────────────┘   └──────────────────┘   └──────────────────┘
```

## Google Services Summary

| Service | Role | Module |
|---|---|---|
| **Gemini Developer API** | Primary AI inference | `server.js` → `getAIResponse()` |
| **Vertex AI** | Fallback AI (ADC) | `server.js` → `getAIResponse()` |
| **Google Cloud Run** | Serverless host | Dockerfile + CI/CD |
| **Google Cloud Logging** | Structured log ingestion | `src/utils/logger.js` |
| **Google Search Grounding** | Real-time factual AI | Gemini `tools: [{googleSearch}]` |
| **Google Cloud Firestore** | Conversation history | `src/utils/firestore.js` |
| **Google Cloud Secret Manager** | Secure secret retrieval | `src/utils/secrets.js` |
| **Google Cloud Monitoring** | Custom metrics | `src/utils/metrics.js` |

## In-Memory Cache

- **Key**: `context::message` (normalized, lowercase)
- **TTL**: 5 minutes
- **Cap**: 100 entries (LRU eviction)
- **Scope**: Per-process (resets on Cloud Run instance restart)
- **Headers**: `X-Cache: HIT` or `X-Cache: MISS`

## Security Layers

1. `helmet()` — CSP, HSTS, X-Content-Type-Options, X-Frame-Options
2. `express-rate-limit` — 50 req/IP/15 min on `/api/chat`
3. `isSafeForPrompt()` — blocks `<script>` and `javascript:` in messages
4. `sanitizeInput()` — HTML-entity escaping for all logged/displayed strings
5. Body size cap — Express JSON parser enforces 50 KB max
6. Secret Manager — optional secure API key retrieval (no plaintext in env)

## Data Flow for Conversation History

```
POST /api/chat
  → AI generates reply
  → saveConversationTurn() [non-blocking Promise]
      → Firestore.collection('conversations').add({
          sessionId, context, userMessage, aiReply,
          tokens, elapsedMs, cached, timestamp
        })
```

Firestore failures are caught and logged — they never affect the response.

## Environment Variables

See [`.env.example`](../.env.example) for the full reference.
