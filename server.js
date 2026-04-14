const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let ai = null;
try {
  ai = new GoogleGenAI({
    vertexai: {
      project: process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0486189266',
      location: 'us-central1'
    }
  });
} catch (e) {
  console.warn("Failed to initialize GoogleGenAI:", e.message);
}

app.post('/api/chat', async (req, res) => {
    try {
        const { message, context } = req.body;
        
        const prompt = `You are LogicFlow Assistant, an AI expert developer and task solver. 
Your current interaction context is: ${context || 'General inquiry'}.
The user has provided the following input: "${message}".

Please provide a helpful, intelligent, and concise response formatted in Markdown. Focus on actionable advice or code snippets if relevant.`;

        if (!ai) {
             return res.json({ 
                reply: `I am currently running in offline mock mode (AI SDK Initialization Failed).\n\n**Here is a simulated response based on your context [${context}]:**\n\nI understand you are asking about: *${message}*.\nAs LogicFlow Assistant, I recommend breaking down your problem into smaller functional blocks to tackle it efficiently.` 
            });
        }

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            res.json({ reply: response.text() });
        } catch (aiError) {
            console.error('AI SDK Error:', aiError);
            res.json({ 
                reply: `I am currently running in offline mock mode (Vertex AI Error: ${aiError.message}).\n\n**Here is a simulated response based on your context [${context}]:**\n\nI understand you are asking about: *${message}*.\nAs LogicFlow Assistant, I recommend breaking down your problem into smaller functional blocks to tackle it efficiently.` 
            });
        }
    } catch (err) {
        console.error('Server Error:', err);
        res.status(500).json({ error: 'Failed to process request.' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
