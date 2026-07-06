# OpenClaw Mission Control Pairing

Guia rapida para volver a conectar Mission Control cuando el navegador abre el
sitio, pero OpenClaw pide aprobar el dispositivo.

## Estado esperado

Mission Control remoto debe abrir en:

```text
https://helix.tail304cfc.ts.net:8443
```

El WebSocket correcto en DevTools > Network > WS debe ser:

```text
wss://helix.tail304cfc.ts.net:8443/gw
Status Code: 101 Switching Protocols
```

`Pending` en Network para un WebSocket abierto es normal. El problema es cuando
la UI dice `pairing required`, `not approved`, o se queda reconectando.

## Cuando se necesita aprobar otra vez

OpenClaw aprueba identidades por navegador/perfil, no por persona.

Vas a necesitar aprobar un pairing nuevo si usas:

- Otro dispositivo.
- Otro navegador.
- Otro perfil del navegador.
- Modo incognito.
- Un navegador donde borraste los datos del sitio.
- Un navegador que genero una identidad nueva de Mission Control.

No deberia pedir aprobacion otra vez si usas el mismo navegador/perfil y no
borraste los datos del sitio.

## Aprobar pairing desde Windows por SSH

Conectate por SSH a la Mac:

```bash
ssh doctor@helix
```

Lista los dispositivos:

```bash
openclaw devices list
```

Busca la seccion `Pending`. Debe verse algo parecido a:

```text
Pending (1)
Request                               Device
c25d8a0c-5156-4a83-b253-e028d6e7703a  Mission Control
```

Aprueba exactamente ese `Request`:

```bash
openclaw devices approve c25d8a0c-5156-4a83-b253-e028d6e7703a
```

Despues recarga Mission Control en el navegador:

```text
Ctrl + Shift + R
```

Confirma que ya no haya pendientes:

```bash
openclaw devices list
```

## Si `openclaw devices list` falla con 1006

Primero revisa que el gateway este corriendo:

```bash
openclaw gateway status
```

Si `gateway status` dice `Connectivity probe: ok`, pero `openclaw devices list`
o `openclaw devices approve` falla con:

```text
gateway closed (1006 abnormal closure)
```

puedes revisar el request pendiente directamente:

```bash
jq '.' ~/.openclaw/devices/pending.json
```

Si ves un request de `Mission Control`, apruebalo con el fallback local de
OpenClaw, reemplazando el ID por el `requestId` pendiente:

```bash
node --input-type=module -e "import { n as approveDevicePairing } from '/opt/homebrew/lib/node_modules/openclaw/dist/device-pairing-DBBF4i61.js'; const requestId='c25d8a0c-5156-4a83-b253-e028d6e7703a'; const r=await approveDevicePairing(requestId,{callerScopes:['operator.admin']}); if(!r){console.error('missing requestId'); process.exit(2)} if(r.status==='forbidden'){console.error(JSON.stringify({status:r.status,reason:r.reason,scope:r.scope})); process.exit(3)} console.log(JSON.stringify({status:r.status,requestId:r.requestId,deviceId:r.device.deviceId,displayName:r.device.displayName,platform:r.device.platform,clientId:r.device.clientId,clientMode:r.device.clientMode,roles:r.device.roles,scopes:r.device.scopes,approvedScopes:r.device.approvedScopes},null,2));"
```

Verifica que no queden pendientes:

```bash
jq 'keys' ~/.openclaw/devices/pending.json
```

El resultado esperado es:

```json
[]
```

## Si el navegador sigue pidiendo pairing

En Brave/Chrome, abre DevTools > Console y ejecuta:

```js
localStorage.removeItem('openclaw.device.auth.v1'); location.reload()
```

No borres `openclaw-device-identity-v1` salvo que quieras generar una identidad
nueva y aprobar otro pairing.

## Comprobaciones utiles

Verificar ruta de Tailscale Serve:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status --json
```

Debe existir esta ruta:

```text
helix.tail304cfc.ts.net:8443 /gw -> http://127.0.0.1:18789
```

Verificar Mission Control local:

```bash
curl -sS -i --max-time 5 http://127.0.0.1:3000/api/health
```

Verificar OpenClaw:

```bash
openclaw gateway status
openclaw health
```

