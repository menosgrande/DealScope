'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn, spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function findBrowser() {
  const candidates = [process.env.CHROME_BIN, 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean);
  for (const command of candidates) {
    const result = spawnSync(command, ['--version'], {encoding:'utf8'});
    if (result.status === 0) return command;
  }
  return null;
}

function createServer() {
  return http.createServer((req, res) => {
    try {
      const requested = decodeURIComponent((req.url || '/').split('?')[0]);
      const pathname = requested === '/' ? '/ci/browser-verify.html' : requested;
      const file = path.resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream'});
      res.end(body);
    } catch (_) {
      res.writeHead(404); res.end('Not found');
    }
  });
}

const browser = findBrowser();
if (!browser) {
  console.error('Browser regression checks require Chrome/Chromium.');
  process.exit(1);
}

const server = createServer();
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/ci/browser-verify.html';
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--dump-dom',
    '--virtual-time-budget=30000',
    url,
  ];
  const child = spawn(browser, args, {stdio:['ignore','pipe','pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  child.on('error', err => {
    server.close();
    console.error(err.message || err);
    process.exit(1);
  });

  child.on('close', code => {
    server.close();

    if (code !== 0) {
      process.stderr.write(stderr);
      process.exit(code || 1);
    }

    if (!stdout.includes('<div id="status">PASS</div>')) {
      process.stderr.write(stdout + '\n' + stderr);
      process.exit(1);
    }

    console.log('✓ browser regression: Pot Odds input / calculation / localStorage restore');
  });
});
