# LogicFlow Assistant 🤖

**PromptWars Virtual Submission**

LogicFlow Assistant is a smart, dynamic AI assistant designed to help developers contextually solve problems, review code, and design system architectures. By adapting to the selected "Execution Context," LogicFlow provides tailored, intelligent responses powered by Google's Vertex AI / Gemini ecosystem.

## 🚀 The Vertical: Developer Productivity & Mentorship
LogicFlow targets the **Developer Productivity** vertical. The chosen persona is an "Expert AI Developer and System Architect." It acts logically based on the user's selected context:
- General Developer Support
- Code Review & Optimization
- System Architecture Design
- Debugging & Error Resolution

## 💡 Approach and Logic
The application consists of a lightweight server-side integration utilizing **Google's Vertex AI (Gemini 2.5 Flash)** and a premium Vanilla HTML/CSS/JS frontend to keep the payload unbloated while focusing on maximum aesthetic impact.
1. **Frontend**: Uses glassmorphism and modern web design principles to wow users immediately. It captures user inputs and context without heavy frameworks. The UI includes dynamic elements like a functional typing indicator and markdown rendering.
2. **Backend**: An Express.js server that processes the user query and the selected execution context, dynamically injecting them into a structured prompt matrix before passing it to Vertex AI.
3. **Google Services**: The assistant strictly relies on **Vertex AI SDK** operating seamlessly under Google App Default Credentials through Google Cloud Run. It securely queries the models.

## 🛠️ How the Solution Works
1. Select your target **Context** from the dropdown on the top right (e.g., "Debugging & Error Resolution").
2. Describe your issue in the chat box at the bottom.
3. The query is transmitted to the Node.js backend running on Google Cloud Run.
4. The backend generates context-aware logic and queries the Gemini 2.5 Flash model.
5. The frontend safely renders the assistant's robust markdown response, displaying code blocks naturally.

## 📝 Assumptions Made
- The user requires instant visual feedback, minimizing interaction friction.
- The assistant operates as a standalone service designed for Cloud Run.
- Cloud Run ensures seamless scaling and authentication handling for Google Services without needing explicit API keys in the source.

---
*Built via Intent-Driven Development with Google Antigravity.*
