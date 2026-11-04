# Reverse proxy deployment

Set the canonical URL and keep the Mission Control backend private. Forwarded
headers are untrusted by default. Enable `MC_TRUSTED_PROXY_HEADERS=1` only
when the proxy overwrites `X-Mission-Control-Proxy-Secret` with the matching
server-side secret. An `X-Forwarded-For` value, including one containing a
proxy address, never establishes trust.

```env
MC_PUBLIC_URL=https://mc.example.com
MC_TRUSTED_PROXY_HEADERS=1
MC_PROXY_HEADER_SECRET=generate-a-long-random-secret
MC_ALLOWED_HOSTS=mc.example.com,localhost,127.0.0.1
MC_COOKIE_SECURE=1
```

> **Breaking change:** `X-Forwarded-Proto` no longer makes session cookies
> secure by itself. Use `MC_PUBLIC_URL`, or enable authenticated forwarded
> headers as shown below. Do not enable `MC_AUTO_LOGIN` behind any reverse
> proxy; it uses host locality as a signal that a proxy can alter.

Configure the proxy to overwrite the forwarding headers and preserve streaming
responses. The gateway WebSocket can be on `/gateway-ws`; set
`NEXT_PUBLIC_GATEWAY_URL=wss://mc.example.com/gateway-ws` at image build time.

## Nginx

```nginx
# This is a template for the official nginx Docker image. Save it as
# /etc/nginx/templates/mission-control.conf.template. Its entrypoint replaces
# ${MC_PROXY_HEADER_SECRET} from the container environment before nginx starts.
# For package-managed nginx, run envsubst on this template before validation and
# reload. Do not use $http_x_mission_control_proxy_secret: that is client input.
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Port $server_port;
  proxy_set_header Forwarded "";
  proxy_set_header X-Mission-Control-Proxy-Secret ${MC_PROXY_HEADER_SECRET};
  proxy_buffering off;
}
location /gateway-ws {
  proxy_pass http://127.0.0.1:18789;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header Forwarded "";
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
    header_up X-Forwarded-Host {host}
    header_up X-Forwarded-Proto {scheme}
    header_up -Forwarded
    flush_interval -1
  }
}
```

This Caddy example relies on `MC_PUBLIC_URL`; leave
`MC_TRUSTED_PROXY_HEADERS` disabled unless you configure Caddy to inject the
same server-side secret. It sets `X-Forwarded-Host` and removes any incoming
`Forwarded` header so downstream behavior is unambiguous.

## Traefik

Use a secure entrypoint on `websecure`, a router for `mc.example.com`, and a
second service for the gateway path. With `MC_PUBLIC_URL`, leave forwarded
header trust disabled and clear both public-origin headers before the upstream:

```yaml
http:
  middlewares:
    mc-origin-headers:
      headers:
        customRequestHeaders:
          Forwarded: ""
          X-Forwarded-Host: ""
```

If dynamic origins are required, use a middleware that overwrites
`X-Forwarded-Host`, clears `Forwarded`, and injects
`X-Mission-Control-Proxy-Secret` from a server-side secret store. Never copy
the incoming client secret header.

## Tailscale Serve

```sh
tailscale serve --https=443 http://127.0.0.1:3000
```

For a gateway on a separate path, configure a second Serve handler forwarding
`/gateway-ws` to `http://127.0.0.1:18789` and set the explicit WebSocket URL
above. Keep `MC_TRUSTED_PROXY_HEADERS` disabled with Tailscale Serve unless you
have separately configured it to overwrite both `Forwarded` and
`X-Forwarded-Host` and inject the shared secret. `MC_PUBLIC_URL` works without
forwarded-header trust.

Subpath hosting (for example `/mission-control`) is not supported because
Next.js static assets and API routes are rooted at `/`. Use a hostname or a
dedicated proxy location instead.
