const express = require('express');
const cors = require('cors');
const path = require('path');
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let ai = null;
let generativeModel = null;
try {
  ai = new VertexAI({
    project: process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0486189266',
    location: 'us-central1'
  });
  generativeModel = ai.getGenerativeModel({ model: 'gemini-1.5-flash-001' });
} catch (e) {
  console.warn("Failed to initialize VertexAI:", e.message);
}

app.post('/api/chat', async (req, res) => {
    try {
        const { message, context } = req.body;
        
        const prompt = `You are LogicFlow: Code Review Assistant, an expert developer and system architect. 
Your current interaction context is: ${context || 'General inquiry'}.
The user has provided the following input: "${message}".

Please provide a helpful, intelligent, subject-specific, and concise response formatted in Markdown. Focus on actionable code optimization, logical explanations, and best practices.`;

        if (!generativeModel) {
            return res.json({ 
                reply: `**LogicFlow Offline Execution**: I understand you are asking about: *${message}*.\nAs LogicFlow: Code Review Assistant, my immediate advice is to modularize your code into functional components and ensure you measure Big-O complexity for any nested operations to avoid bottlenecks. (Vertex AI SDK Initialization required for detailed dynamic analysis).` 
            });
        }

        try {
            const response = await generativeModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            res.json({ reply: response.response.candidates[0].content.parts[0].text });
        } catch (aiError) {
            console.error('AI SDK Error:', aiError);
            res.json({ 
                reply: `**LogicFlow Offline Fallback**: (Vertex AI returning ${aiError.message}).\n\nI understand you are asking about: *${message}*.\nAs LogicFlow: Code Review Assistant, I strongly recommend checking your nested loop complexity. You can often break big $O(N^2)$ loops by using HashMaps $O(1)$ lookup or applying vectorized operations via NumPy/Pandas in Python.` 
            });
        }
    } catch (err) {
        console.error('Server Error:', err);
        res.status(500).json({ error: 'Failed to process request.' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
