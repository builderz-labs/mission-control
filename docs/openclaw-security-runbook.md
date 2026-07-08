# OpenClaw Security Runbook para helix

Este runbook resume el estado seguro esperado para Mission Control + OpenClaw en
la Mac `helix`, accesible desde Windows/Brave por Tailscale.

## Verificacion rapida

Ejecuta estos comandos en la Mac, por SSH:

```bash
cd ~/.openclaw
~/dev/helix-ops/scripts/openclaw-node26.sh gateway status
~/dev/helix-ops/scripts/openclaw-node26.sh doctor
~/dev/helix-ops/scripts/openclaw-node26.sh security audit --deep
~/dev/helix-ops/scripts/openclaw-node26.sh sandbox explain --json
~/dev/helix-ops/scripts/openclaw-node26.sh secrets audit --json
```

Estado esperado:

- Gateway: `Connectivity probe: ok` y `Capability: admin-capable`.
- Sandbox: `mode: "all"` y `sessionIsSandboxed: true`.
- Doctor: puede mostrar warnings amarillos manuales; no deberia mostrar
  `FsSafeError: root dir not found`.
- Security audit: puede seguir marcando el plugin `codex` por uso de
  `child_process`; eso es funcionalidad esperada del plugin, controlada por
  sandbox y politicas de herramientas.

## Cambios aplicados

- OpenClaw se ejecuta desde Mission Control con `OPENCLAW_STATE_DIR` y sin
  `OPENCLAW_HOME`, para evitar el error `root dir not found`.
- Mission Control usa `~/dev/helix-ops/scripts/openclaw-node26.sh` para llamar
  OpenClaw con Node compatible.
- El sandbox de agentes quedo en `agents.defaults.sandbox.mode="all"`.
- El agente `main` tambien quedo en `sandbox.mode="all"`.
- Se removio el fallback local pequeno `ollama/qwen3-coder-30b-64k` de los
  fallbacks globales.
- Los modelos Ollama locales tienen denegados `group:web` y `browser`.
- `gateway.trustedProxies` incluye solo `127.0.0.1` y `::1`.
- `tools.elevated.enabled=false`, para impedir escapes de `exec` fuera del
  sandbox.
- Se construyo la imagen local `openclaw-sandbox:bookworm-slim`.
- Se endurecieron permisos:
  - `~/.openclaw`: `700`
  - `~/.openclaw/openclaw.json`: `600`
  - `~/.openclaw/agents`: `700`
  - `~/.openclaw/agents/helix`: `700`
  - `~/.openclaw/workspace/memory/.dreams/short-term-recall.json`: `600`

Backup de config previo al endurecimiento:

```text
~/.openclaw/openclaw.json.pre-security-hardening-20260706T202351Z
~/.openclaw/openclaw.json.pre-elevated-disable-*
```

## Warnings conocidos

### Memory Core legacy

Mensaje:

```text
Skipped Memory Core short-term recall import ...
```

Significa que el estado ya existe en SQLite y quedo una fuente legacy en JSON.
Riesgo actual bajo por permisos `600` y directorio padre `700`.

No borrar automaticamente. Si se quiere limpiar, primero archivar el archivo y
validar que Memory Core siga funcionando.

### MCP sandbox allowlist

Mensaje:

```text
mcp.servers defines ... tools.sandbox.tools.alsoAllow ...
```

Esto aparecio porque el sandbox esta activo. Es conservador: los MCP `obsidian`
y `playwright` no se exponen a agentes sandboxed hasta permitirlos
explicitamente.

Para seguridad, dejarlo asi salvo que necesites esos MCP dentro de agentes.

### OAuth dir no presente

Mensaje:

```text
OAuth dir not present (~/.openclaw/credentials)
```

Es informativo si no hay WhatsApp/pairing channel activo. No requiere accion.

### Agent dir helix sin agents.list

Mensaje:

```text
Found 1 agent directory on disk without a matching agents.list entry.
Examples: helix
```

Puede contener estado viejo. No borrar sin confirmar que no se necesita.
Mientras tanto queda protegido por permisos `700`.

### Plaintext gateway token — RESUELTO (2026-07-08, HLX-219)

Warning original:

```text
openclaw.json contains plaintext secret-bearing config fields.
Paths: gateway.auth.token
```

Cerrado. `gateway.auth.token`, `channels.telegram.botToken` y el bloque
`secrets` ya no contienen valores en plano: son SecretRefs
(`{source,provider,id}`) que OpenClaw resuelve via el wrapper user-owned
`~/.openclaw/secrets/kc-resolver.sh` contra el login Keychain. Grep de tokens
en `openclaw.json` = 0 literales.

No se migro a `op://`: `op read` cuelga en contexto launchd/daemon (ver memoria
op-launchd-incompatible), lo que romperia el arranque del gateway. Backend
elegido = Keychain, no 1Password runtime.

Cada `secrets.providers.kc_*` invoca el resolver con el nombre de servicio del
item Keychain (ej. `helix-gateway-auth-token`, `helix-telegram-mac-bot-token`).
El resolver hace `security find-generic-password -s <svc> -w` y quita el `\n`
final que corrompe headers de auth.

Restriccion de sesion: el resolver solo lee el login Keychain desde la sesion
GUI del usuario (`gui/501`), donde el keychain esta desbloqueado. El gateway
corre como LaunchAgent en `gui/501`, asi que resuelve bien. Una sesion
"Background"/SSH NO alcanza el login Keychain (`User interaction is not
allowed`) — no intentar validar el resolver ni re-seed desde ahi; da falso
negativo.

## SecretRefs y 1Password

Regla operativa: 1Password es la fuente de verdad de todo secreto. No guardar
tokens en plano en `openclaw.json`, `.env`, logs, scripts ni el chat. La config
local solo debe contener SecretRefs.

Backend por contexto:

- **Gateway (launchd/`gui/501`)**: SecretRef via Keychain (`kc-resolver.sh`). NO
  usar `op://` runtime — `op read` cuelga en contexto daemon. El login Keychain
  hace de cache local desbloqueado; 1Password sigue siendo la fuente desde la
  que se siembra.
- **Otros contextos con GUI/`op` estable**: `op://...` directo es aceptable.

Desde SSH, no ejecutes `openclaw secrets audit --allow-exec` como unica fuente
de verdad hasta validar acceso de `op read`. En esta instalacion la app de
1Password puede estar abierta, pero `op` puede fallar desde una sesion SSH si no
puede conectarse a la integracion de escritorio.

### Rotacion de un secreto Keychain (gateway/telegram)

Ejecutar desde la sesion GUI del usuario (`gui/501`), NO por SSH/Background.
El valor nunca debe ir en argv (queda en historial y en `ps`). `-w` sin
argumento hace que `security` pida el valor por prompt interactivo: copiar el
secreto desde la app de 1Password y pegarlo ahi.

```bash
# 1. Re-sembrar el item. -U actualiza si ya existe. Al no pasar valor tras -w,
#    security pide "password data for new item:" dos veces -> pegar el valor
#    copiado de 1Password (fuente de verdad). No aparece en el shell history.
security add-generic-password -U -a doctor -s helix-gateway-auth-token \
  -T /usr/bin/security -w

# 2. Verificar que el resolver lo lee (sin imprimir el secreto):
~/.openclaw/secrets/kc-resolver.sh helix-gateway-auth-token >/dev/null && echo OK

# 3. Recargar el gateway para que tome el valor nuevo:
launchctl kickstart -k gui/501/ai.openclaw.gateway
curl -fsS http://127.0.0.1:18789/health   # espera {"ok":true,"status":"live"}
```

Alternativa no interactiva (para automatizar): mantener el valor fuera de argv
usando una variable de entorno leida de 1Password y `expect`, o el helper de
seeding de OpenClaw si esta disponible. Nunca `-w "$TOKEN"` en una linea que
quede en el history.

Servicios Keychain vigentes: `helix-gateway-auth-token`,
`helix-telegram-mac-bot-token`, `helix-anthropic-api-key`, `helix-minimax-token`,
`helix-brave-api-key`, `helix-firecrawl-api-key`.

## Discord

El plugin `@openclaw/discord` esta instalado y fijado a `2026.6.11`, pero el
canal no debe activarse hasta que el token del bot pueda resolverse desde
1Password.

Estado esperado para activarlo:

1. El bot token existe en 1Password como
   `op://Helix/Helix Secrets/DISCORD_BOT_TOKEN/value`.
2. `op read` funciona desde el contexto del gateway sin imprimir el token.
3. `channels.discord.token` usa SecretRef `exec` hacia 1Password.
4. `channels.discord.dmPolicy` y `channels.discord.groupPolicy` quedan en
   `allowlist`, con IDs de Discord estables. No usar politica `open`.

## Reinicios utiles

Reiniciar Mission Control despues de cambios de codigo:

```bash
launchctl kickstart -k gui/501/com.helix.mission-control
curl -fsS http://127.0.0.1:3000/api/health
```

Revisar gateway:

```bash
~/dev/helix-ops/scripts/openclaw-node26.sh gateway status
```

Reiniciar gateway solo cuando sea necesario:

```bash
launchctl kickstart -k gui/501/ai.openclaw.gateway
~/dev/helix-ops/scripts/openclaw-node26.sh gateway status
```
