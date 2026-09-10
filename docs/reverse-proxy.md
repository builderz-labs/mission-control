# Reverse proxy deployment

Set the canonical URL and the address of the proxy that connects to Mission
Control. Forwarded headers are ignored unless the nearest proxy appears as the
right-most `X-Forwarded-For` hop.

```env
MC_PUBLIC_URL=https://mc.example.com
MC_TRUSTED_PROXY_IPS=127.0.0.1
MC_ALLOWED_HOSTS=mc.example.com,localhost,127.0.0.1
MC_COOKIE_SECURE=1
```

Configure the proxy to overwrite the forwarding headers and preserve streaming
responses. The gateway WebSocket can be on `/gateway-ws`; set
`NEXT_PUBLIC_GATEWAY_URL=wss://mc.example.com/gateway-ws` at image build time.

## Nginx

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Port $server_port;
  proxy_buffering off;
}
location /gateway-ws {
  proxy_pass http://127.0.0.1:18789;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 86400;
}
```

## Caddy

```caddyfile
mc.example.com {
  reverse_proxy /gateway-ws 127.0.0.1:18789
  reverse_proxy 127.0.0.1:3000 {
    header_up Host {host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
    flush_interval -1
  }
}
```

## Traefik

Use a secure entrypoint on `websecure`, a router for `mc.example.com`, and a
second service for the gateway path. Enable the `headers` middleware with
`customRequestHeaders` for `X-Forwarded-For`, `X-Forwarded-Proto`, and
`X-Forwarded-Port`, replacing client supplied values at the edge.

## Tailscale Serve

```sh
tailscale serve --https=443 http://127.0.0.1:3000
```

For a gateway on a separate path, configure a second Serve handler forwarding
`/gateway-ws` to `http://127.0.0.1:18789` and set the explicit WebSocket URL
above. Tailscale's local proxy address must be included in
`MC_TRUSTED_PROXY_IPS` when forwarded origin headers are used.

Subpath hosting (for example `/mission-control`) is not supported because
Next.js static assets and API routes are rooted at `/`. Use a hostname or a
dedicated proxy location instead.
