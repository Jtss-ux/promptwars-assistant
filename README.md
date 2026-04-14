# LogicFlow: Code Review Assistant 🤖

**PromptWars Virtual Submission**

LogicFlow: Code Review Assistant is a smart, dynamic AI assistant designed to help developers contextually solve coding problems, review code, and design system architectures. By adapting to the selected "Execution Context," LogicFlow provides tailored, intelligent responses powered by Google's Vertex AI / Gemini ecosystem.

## 🚀 The Vertical: Developer Productivity & Mentorship
LogicFlow targets the **Developer Productivity** vertical. The chosen persona is an "Expert AI Developer and System Architect." It acts logically based on the user's selected context:
- General Developer Support
- Code Review & Optimization
- System Architecture Design
- Debugging & Error Resolution

## 💡 Approach and Logic
The application consists of a lightweight server-side integration utilizing **Google's Vertex AI (Gemini 2.5 Flash)** and a premium Vanilla HTML/CSS/JS frontend to keep the payload unbloated while focusing on maximum aesthetic impact.
1. **Frontend**: Uses glassmorphism and modern web design principles to wow users immediately. It captures user inputs and context without heavy frameworks, utilizing dynamic elements like typing animations, premium syntax highlighting, and Markdown exports.
2. **Backend**: An Express.js server that dynamically constructs robust prompts based on selected execution contexts, ensuring the LLM explicitly adheres to expert development best practices.
3. **Meaningful Google Services Integration**: The application strictly relies on the **Vertex AI SDK / Gemini 2.5 Flash** integrated natively with **Google Search Grounding**. This allows LogicFlow to run real-time queries against the internet to validate code against the latest docs—preventing outdated hallucinations. Ensure it runs securely using App Default Credentials via Google Cloud Run or a `.env` API key.

## 🛠️ How the Solution Works
1. Select your target **Context** from the dropdown on the top right (e.g., "Debugging & Error Resolution").
2. Describe your issue in the chat box at the bottom.
3. The query is transmitted to the Node.js backend running on Google Cloud Run.
4. The backend generates context-aware logic and queries the Gemini 2.5 Flash model.
5. The frontend safely renders the assistant's robust markdown response, displaying code blocks naturally.

## 🧪 Automated Testing
LogicFlow is equipped with reliable End-to-End (E2E) testing powered by the native `node:test` runner. The test suite automatically validates UI responses, API status codes, error handling (400 Bad Requests), and live AI integrations.
To execute the tests locally:
```bash
npm test
```

## 📝 Assumptions Made
- The user requires instant visual feedback, minimizing interaction friction.
- The assistant operates as a standalone service designed for Cloud Run.
- Cloud Run ensures seamless scaling and authentication handling for Google Services without needing explicit API keys in the source.

---
*Built via Intent-Driven Development with Google Antigravity.*
