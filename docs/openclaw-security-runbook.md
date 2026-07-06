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

### Plaintext gateway token

Mensaje:

```text
openclaw.json contains plaintext secret-bearing config fields.
Paths: gateway.auth.token
```

Riesgo actual controlado parcialmente por `openclaw.json` en `600`, pero no
cerrado por completo. La migracion correcta es moverlo a SecretRef y despues
actualizar el arranque de Mission Control para resolver el SecretRef en vez de
leer un string plano.

No migrar este token a ciegas: Mission Control actualmente lo lee desde
`openclaw.json` al arrancar.

## SecretRefs y 1Password

Regla operativa: todos los secretos y contrasenas viven en 1Password. No guardar
tokens nuevos en `openclaw.json`, Keychain, archivos locales, `.env`, logs,
scripts ni el chat. La configuracion local solo debe contener SecretRefs o rutas
`op://...` no secretas.

Desde SSH, no ejecutes `openclaw secrets audit --allow-exec` como unica fuente
de verdad hasta validar acceso de `op read`. En esta instalacion la app de
1Password puede estar abierta, pero `op` puede fallar desde una sesion SSH si no
puede conectarse a la integracion de escritorio.

Antes de mover `gateway.auth.token` a SecretRef:

1. Validar que `op read 'op://Helix/Helix Secrets/<ID>/value'` resuelve desde
   el mismo contexto donde corre el gateway o elegir un backend de 1Password
   no interactivo aprobado.
2. Ajustar `~/dev/helix-ops/scripts/start-mission-control.sh` para resolver
   SecretRef, no solo plaintext JSON.
3. Generar plan con `openclaw secrets configure --plan-out <archivo>`.
4. Probar con `openclaw secrets apply --from <archivo> --dry-run`.
5. Aplicar, recargar secretos y reiniciar gateway + Mission Control.

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
