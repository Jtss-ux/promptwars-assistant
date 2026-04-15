'use strict';
const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Lines 477-503: replace the AI invocation block
// Split on lines, replace the block, rejoin
const lines = code.split('\n');

// Find the start line (contains "AI Invocation") and end line (line 503 = "    });")
let startLine = -1;
let endLine = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('AI Invocation')) {
    startLine = i;
  }
  // The closing }); of the res.json block right before the catch
  if (startLine !== -1 && endLine === -1) {
    if (lines[i].trim() === '});' && i > startLine + 5) {
      // verify the next non-empty line is the catch block
      let next = i + 1;
      while (next < lines.length && lines[next].trim() === '') next++;
      if (lines[next] && lines[next].includes('} catch')) {
        endLine = i;
        break;
      }
    }
  }
}

console.log('startLine:', startLine + 1, 'endLine:', endLine + 1);

if (startLine === -1 || endLine === -1) {
  console.error('Could not find block boundaries');
  process.exit(1);
}

const newLines = [
  `    // -- AI Invocation (with in-memory cache) -----------------------------------`,
  `    const cacheKey = getCacheKey(context, rawMessage);`,
  ``,
  `    // Serve from cache if a valid, unexpired entry exists`,
  `    if (cacheKey) {`,
  `      const cached = responseCache.get(cacheKey);`,
  `      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {`,
  `        log('INFO', 'Cache hit -- returning cached AI response.', { context, cacheKey });`,
  `        res.setHeader('X-Cache', 'HIT');`,
  `        return res.json({ reply: cached.reply, stats: cached.stats, cached: true });`,
  `      }`,
  `    }`,
  ``,
  `    res.setHeader('X-Cache', 'MISS');`,
  `    const startTime = Date.now();`,
  `    const result = await getAIResponse(prompt);`,
  `    const elapsedMs = Date.now() - startTime;`,
  ``,
  `    log('INFO', 'Chat response generated.', {`,
  `      context: sanitizeInput(context),`,
  `      elapsedMs,`,
  `      promptTokens: result.promptTokens,`,
  `      totalTokens: result.totalTokens,`,
  `    }, {`,
  `      requestMethod: req.method,`,
  `      requestUrl: req.originalUrl,`,
  `      status: 200,`,
  `      userAgent: req.headers['user-agent'] || '',`,
  `      latency: \`\${(elapsedMs / 1000).toFixed(3)}s\`,`,
  `    });`,
  ``,
  `    const responseBody = {`,
  `      reply: result.text,`,
  `      stats: {`,
  `        elapsed: (elapsedMs / 1000).toFixed(2),`,
  `        promptTokens: result.promptTokens,`,
  `        outputTokens: result.outputTokens,`,
  `        totalTokens: result.totalTokens,`,
  `      },`,
  `    };`,
  ``,
  `    // Store successful AI response in cache for future identical queries`,
  `    if (cacheKey) {`,
  `      responseCache.set(cacheKey, {`,
  `        reply: responseBody.reply,`,
  `        stats: responseBody.stats,`,
  `        timestamp: Date.now(),`,
  `      });`,
  `      pruneCache();`,
  `    }`,
  ``,
  `    return res.json(responseBody);`,
];

lines.splice(startLine, endLine - startLine + 1, ...newLines);
fs.writeFileSync('server.js', lines.join('\n'));
console.log('Patch applied. Total lines:', lines.length);
