const WebSocket = require('ws');
const ws = new WebSocket('wss://minint-rjdgqcb-2.tail9c6d28.ts.net/ws-proxy', {
  rejectUnauthorized: false,
  origin: 'https://minint-rjdgqcb-2.tail9c6d28.ts.net'
});
ws.on('open', () => {
  console.log('connected!');
  ws.send(JSON.stringify({
    type: 'req',
    method: 'connect',
    id: 'test-1',
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      auth: { token: '7f719ab236696e343f1862d0496ce97daa9e9945621af1f62c9f72304c137969' },
      client: {
        id: 'openclaw-control-ui',
        version: '1.0',
        mode: 'ui',
        platform: 'web'
      },
      role: 'operator'
    }
  }));
});
ws.on('error', (e) => console.error('error', e.message));
ws.on('close', (code, reason) => console.log('closed', code, reason.toString()));
ws.on('message', (m) => console.log('msg', m.toString()));
