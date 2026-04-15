'use strict';
const { spawn } = require('node:child_process');
const PORT = 8081;

const p = spawn('node', ['server.js'], {
  env: { ...process.env, PORT },
  stdio: 'pipe',
});

let out = '';
p.stdout.on('data', d => { out += d; process.stdout.write('STDOUT: ' + d); });
p.stderr.on('data', d => { out += d; process.stderr.write('STDERR: ' + d); });
p.on('error', e => console.error('SPAWN ERROR:', e));
p.on('exit', (code, sig) => console.log('EXITED code=%s sig=%s', code, sig));

setTimeout(async () => {
  console.log('\n--- Trying health check ---');
  try {
    const res = await fetch(`http://localhost:${PORT}/health`);
    console.log('Health status:', res.status);
    console.log('Body:', await res.json());
  } catch (e) {
    console.error('Health check FAILED:', e.message);
    console.log('Server output so far:\n', out);
  }
  p.kill();
  process.exit(0);
}, 4000);
