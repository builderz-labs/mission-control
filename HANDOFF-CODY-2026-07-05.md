# Handoff MC — estado al 2026-07-06 ~00:30 CST (v3, cierre de noche)

## ⚠️ ÚLTIMO DATO (00:30): WS del navegador SIGUE CAÍDO tras todos los fixes desplegados

Musa probó y el WS no conecta. Dato de diagnóstico fresco: `openclaw devices list` = **1 device pareado (backend MC, operator/admin) y CERO requests pendientes** → el intento del navegador NO llega al gateway ni a fase de pairing. Muere antes, en el cliente. Siguiente paso obligado (nadie lo ha hecho): **DevTools en el navegador de Musa** sobre `https://helix.tail304cfc.ts.net:8443` — Console + Network/WS: ver qué URL exacta arma MC para el WebSocket y con qué error falla (mixed content, DNS, TLS, 4xx del gateway, token vacío). Sin ese dato es adivinar. Candidatos: `/api/gateways/connect` regresa `ws_url` con host 127.0.0.1 (fila `gateways` en DB dice host=127.0.0.1 — el navegador remoto NO puede usar eso y el redirect/rewrite browser-facing quizá no lo traduce); o el token no viaja al cliente.

Cody se quedó sin créditos (reset 03:39 6-jul) a media tarea. Cloddy también limitado. Este doc = fuente de verdad del retome. **Snapshot de TODO el trabajo sin commitear: `~/dev/mission-control-backups/wip-cody-cloddy-20260705T231729.patch`** — si algo hace `git reset`, se recupera con `git apply`.

## Estado desplegado (bundle corriendo AHORA, verificado /health 200)

Branch `v2.1.0-deploy` (tag v2.1.0 + patches locales). LaunchAgent `com.helix.mission-control` sirviendo build que YA incluye:

1. **Protocolo 3..4 en backend** (`src/lib/openclaw-gateway.ts`, Cloddy) — `node.list` RPC verificado OK por Cody.
2. **localStorage ya NO pisa al server** (`page.tsx` + `gateway-url.ts`, Cody): URL resuelta por server gana; `mc-gateway-url` stale se borra solo si difiere. Con tests (`gateway-url.test.ts`, 61 pass) + tsc limpio.
3. **Botón doctor tolerante a Tailscale Serve** (`api/openclaw/doctor/route.ts`, Cody): "port 18789 busy" ya no es fatal si `gateway status` da probe ok + admin-capable. Con test.

## Trabajo A MEDIAS (editado pero NO desplegado ni cableado)

- `src/lib/browser-security.ts`: helper `buildCanonicalHttpsRedirectUrl()` creado pero **NO cableado en `src/proxy.ts`** — la idea de Cody: requests HTTP a helix corto / IP → redirect al FQDN HTTPS canónico (preserva path/query, solo GET/HEAD, anti-loop). Falta: (1) cablear en proxy.ts antes de auth, (2) test, (3) `./node_modules/.bin/next build` + `launchctl kickstart -k gui/501/com.helix.mission-control`. Helper sin uso = build actual no cambia comportamiento; no urge, pero termínalo o revierte ese archivo.

## Hallazgos de Cody que quedaron confirmados

- `FsSafeError root dir not found` del doctor --fix: NO reproduce ya (era log viejo + config inválida de entonces). El fallo actual del --fix es solo el guard del puerto compartido → mitigado en el endpoint.
- `CONTROL_UI_DEVICE_IDENTITY_REQUIRED`: el control UI remoto EXIGE secure context. **URL canónica para Musa: `https://helix.tail304cfc.ts.net:8443`** — http://helix:3000 carga la página pero no sirve para la flota viva.
- Config openclaw VÁLIDA (llave `elevated` removida por Cloddy; owner `telegram:1565892648` configurado).

## Qué falta para cerrar el frente (en orden)

1. **Commitear** los 7 archivos modificados en `v2.1.0-deploy` (convención del repo: conventional commits, NO AI attribution). Sugeridos: `fix: negotiate gateway protocol 3..4 in backend connect` · `fix: server-resolved gateway URL wins over stale localStorage` · `fix: tolerate shared port 18789 in doctor --fix endpoint`. Candidatos a PR upstream (bug protocolo backend sigue vivo en su main).
2. Terminar o revertir el redirect canónico (browser-security.ts + proxy.ts).
3. **Prueba E2E real de Musa**: abrir `https://helix.tail304cfc.ts.net:8443`, login, ver si la flota carga. Si el gateway pide device pairing: `openclaw devices list` → `openclaw devices approve <requestId>`.
4. Follow-ups no urgentes: SecretRefs para `gateway.auth.token` · PR upstream · HLX-217 (formato RPG, post-gate 5.4).

## Gotchas vigentes (no re-descubrir)

- `openclaw gateway restart` falla "port busy" por el forwarder de Tailscale Serve → `stop`, sleep, `start`.
- Botón "Run Doctor Fix" de la UI: ya mitigado en endpoint, pero doctor por terminal sigue siendo lo confiable.
- pnpm en no-TTY necesita `CI=true`; vitest/tsc/next usar `./node_modules/.bin/` directo (pnpm dispara verificación de firma que falla).
- node = `/opt/homebrew/opt/node@22/bin` (keg-only). Tras cambiar Node: `pnpm rebuild better-sqlite3`.
- Backups: DB/env `~/dev/mission-control-backups/` · configs gateway `~/.openclaw/openclaw.json.pre-*` · patch WIP (arriba).

## Contexto mañana 6-jul (no pisar)

HLX-215 (P0 YouTube→Linear) temprano · **gate 5.4 apagar Pi: 13:20 CST** · post-GO: etapa C HLX-203. MC no bloquea nada de eso.
