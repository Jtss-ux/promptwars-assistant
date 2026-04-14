const { VertexAI } = require('@google-cloud/vertexai');

async function run() {
  try {
    const ai = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0486189266',
      location: 'us-central1'
    });
    const generativeModel = ai.getGenerativeModel({ model: 'gemini-1.5-flash-002' });
    const response = await generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: "Hello!" }] }],
    });
    console.log(response.response.candidates[0].content.parts[0].text);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
