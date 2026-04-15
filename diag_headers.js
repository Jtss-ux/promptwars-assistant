'use strict';
const { app } = require('./server');

const PORT = 8099;
const server = app.listen(PORT, async () => {
  try {
    const res = await fetch(`http://localhost:${PORT}/health`);
    console.log('\n=== /health headers ===');
    for (const [k, v] of res.headers.entries()) {
      console.log(`  ${k}: ${v}`);
    }
    const res2 = await fetch(`http://localhost:${PORT}/`);
    console.log('\n=== / headers ===');
    for (const [k, v] of res2.headers.entries()) {
      console.log(`  ${k}: ${v}`);
    }
  } finally {
    server.close();
  }
});
server.on('error', e => console.error('Server error:', e));
