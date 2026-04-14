const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Gemini SDK Init ─────────────────────────────────────────────────────────
// Uses GEMINI_API_KEY env var (set as a Cloud Run secret).
// Falls back to Vertex AI ADC if GOOGLE_CLOUD_PROJECT is set (Cloud Run).
let genAI = null;

async function getAIResponse(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const project = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0486189266';

  if (apiKey) {
    // Path 1: Gemini Developer API (API Key)
    const { GoogleGenAI } = require('@google/genai');
    if (!genAI) genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model: 'models/gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });
    return response.candidates[0].content.parts[0].text;
  } else {
    // Path 2: Vertex AI (Cloud Run Service Account – ADC)
    const { VertexAI } = require('@google-cloud/vertexai');
    const vertex = new VertexAI({ project, location: 'us-central1' });
    const model = vertex.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return result.response.candidates[0].content.parts[0].text;
  }
}

// ─── Chat Endpoint ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const prompt = `You are **LogicFlow: Code Review Assistant**, a senior software engineer and system architect AI.
Your current session context: **${context || 'General Developer Support'}**.
User query: "${message}"

When providing 'General Developer Support', always strongly adhere to and explicitly mention this expert advice:
- Break your problem into small, testable units
- Write clear function signatures with type hints
- Use version control (git) for every experiment
- Measure before optimizing — profile first, fix bottlenecks second
- Document your decision rationale, not just the code

Respond with expert, actionable advice in Markdown format. Include relevant code snippets, complexity analysis, best practices and concrete next steps. Be specific — never give a generic answer.`;

    const reply = await getAIResponse(prompt);
    res.json({ reply });
  } catch (err) {
    console.error('Chat Error:', err.message);
    // Smart contextual fallback — always gives a useful answer
    const { message, context } = req.body;
    const fallbacks = {
      'Code Review & Optimization': `## Code Review Tips\n\n**For your query**: *${message}*\n\n- Use \`enumerate()\` instead of \`range(len())\`\n- Replace nested loops with dict lookups (O(1) vs O(n))\n- Use \`numpy\` vectorization for numerical operations\n- Profile with \`cProfile\` before optimizing\n\n\`\`\`python\n# Instead of:\nfor i in range(len(arr)):\n    for j in range(len(arr)):\n        ...\n# Use:\nlookup = {val: idx for idx, val in enumerate(arr)}\n\`\`\``,
      'Architecture Design': `## Architecture Guidance\n\n**For your query**: *${message}*\n\n- Apply **SOLID principles** — single responsibility, open/closed\n- Prefer **microservices** for independently scalable components\n- Use **event-driven patterns** (pub/sub) for async workflows\n- Design for **failure** — circuit breakers, retries, timeouts`,
      'Bug Detection & Debugging': `## Debugging Strategy\n\n**For your query**: *${message}*\n\n1. **Reproduce** reliably first — exact inputs matter\n2. **Bisect** the code — reduce scope with binary search\n3. **Add structured logging** at boundary points\n4. Check **race conditions** if async/threaded\n5. Use \`pdb\` (Python) or \`debugger;\` (JS) for interactive inspection`,
      'API & Integration': `## API Integration Best Practices\n\n**For your query**: *${message}*\n\n- Always **validate** request/response schemas (Zod, Pydantic)\n- Use **exponential backoff** on retries (2s, 4s, 8s...)\n- Cache responses with **TTL** to reduce load\n- Secure with **OAuth 2.0 / API keys via env vars**, never hardcode`,
    };
    const fallback = fallbacks[context] || `## LogicFlow Response\n\n**For your query**: *${message}*\n\nHere's expert advice based on your context *${context || 'General'}*:\n\n- Break your problem into **small, testable units**\n- Write clear **function signatures** with type hints\n- Use **version control** (git) for every experiment\n- Measure before optimizing — profile first, fix bottlenecks second\n- Document your **decision rationale**, not just the code`;
    res.json({ reply: fallback });
  }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ai: !!process.env.GEMINI_API_KEY ? 'gemini-api-key' : 'vertex-ai-adc' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`LogicFlow server running on port ${PORT}`));
