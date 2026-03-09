const crypto = require('crypto');
const http = require('http');

const secret = 'c0d40712bca5f32d47339845ed7251df06dd70f0097a93902b1207336cd917a1';
const payload = JSON.stringify({
  action: 'opened',
  pull_request: {
    title: 'Update dependencies and fix UI',
    html_url: 'https://github.com/owner/repo/pull/123',
    number: 123,
    user: { login: 'octocat' }
  },
  repository: { full_name: 'owner/repo' }
});

const hmac = crypto.createHmac('sha256', secret);
const signature = 'sha256=' + hmac.update(payload).digest('hex');

const options = {
  hostname: '127.0.0.1',
  port: 3005,
  path: '/api/github/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-github-event': 'pull_request',
    'x-hub-signature-256': signature,
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(payload);
req.end();
