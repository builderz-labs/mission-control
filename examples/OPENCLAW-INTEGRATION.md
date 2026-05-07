# OpenClaw + Mission Control — additive integration walkthrough

> **Принцип:** этот гайд **только добавляет** OpenClaw как соседний сервис.
> Существующий direct-API/CLI dispatch path остаётся как fallback. Если
> openclaw остановлен или недоступен — MC автоматически возвращается в
> direct-режим без правок конфига.

OpenClaw (https://github.com/openclaw/openclaw) — это «личный AI-ассистент»
с полноценным **gateway control plane**: persistent agent sessions, tool-use,
multi-CLI routing (Claude / Codex / Gemini / local), 24+ messaging-каналов.
MC изначально проектировался под этот gateway — раздел `OPENCLAW_GATEWAY_*` в
`docker-compose-dev.yml` уже указывает на `host.docker.internal:18789` (это
точный дефолтный порт openclaw).

## Что меняется при поднятом openclaw

| Возможность | Без openclaw (сейчас) | С openclaw |
|---|---|---|
| Architect / Dev / Linter | one-shot LLM call (`claude --print`, REST `/chat/completions`) | persistent session с tool-use |
| Чтение файлов / запуск тестов агентом | нет | да (через bundled tools openclaw) |
| `chat.send` в существующую сессию | игнорируется | работает: задача попадает в открытую сессию агента |
| Pipelines в UI (`/orchestration` → tab Pipelines) | падает с `spawn openclaw ENOENT` | работает по дизайну |
| Status агентов | всегда `offline` | `online` / `idle` / `busy` через heartbeat |
| Broadcast | пусто | долетает до живых PTY-сессий |
| Session viewer таб у задачи | jsonl с диска | live PTY stream + tool_use timeline |
| Multi-channel ingestion (Telegram/Slack/...) | нет | да — задачи могут приходить из messaging |

## Предусловия

- Docker Engine + `docker compose v2`
- ≥ 4 ГБ RAM свободно (build openclaw тянет full Node.js + bun + pnpm install)
- API-ключи провайдеров, которых хочешь использовать: OpenAI, Anthropic, Gemini,
  OpenRouter — любые, openclaw разрулит.
- Свободные порты `18789` и `18790` на хосте.
- ≥ 1.5 ГБ места под `./.openclaw-data` (config + sessions DB + plugin runtime).

## Шаг 1. Клонирование openclaw в подкаталог

```bash
cd /path/to/mission-control
make openclaw-clone
```

Создаёт `./openclaw-src/` (в `.gitignore`). Команда идемпотентна — повторный
вызов делает `git pull`.

## Шаг 2. Сборка образа

```bash
make openclaw-build
```

Первый build занимает 5–10 минут (full Node.js 24 + Bun + pnpm install +
TypeScript build). Образ называется `mc-openclaw:local`.

## Шаг 3. Минимальный `.env.openclaw`

Скопируй пример:
```bash
cp .env.openclaw.example .env.openclaw
```

И заполни **только то, что используешь** — например, если планируешь, чтобы
gateway гонял задачи через Claude и OpenAI:
```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENCLAW_GATEWAY_TOKEN=    # пусто — пусть gateway сам сгенерирует
```

> Можно положить эти же ключи в обычный `.env` — оба compose-файла его читают.

## Шаг 4. Старт gateway

```bash
make openclaw-up
```

Проверка через 30-60 секунд:
```bash
make openclaw-status
# Gateway HTTP: 200
# Config:       .openclaw-data/openclaw.json present
# MC token:     NOT set in .env — copy from .openclaw-data/openclaw.json
```

## Шаг 5. Скопировать gateway-токен в MC `.env`

При первом старте openclaw сам сгенерировал токен и положил его в
`./.openclaw-data/openclaw.json`. MC должен этот же токен предъявлять в
запросах:

```bash
TOKEN=$(make openclaw-token)
echo "OPENCLAW_GATEWAY_TOKEN=$TOKEN" >> .env
```

Перезапусти MC dev-стек чтобы переменная подхватилась:
```bash
make dev-down && make dev
```

(Production-стек: `make restart`.)

## Шаг 6. Onboard gateway (один раз)

Запусти интерактивный мастер openclaw — он спрашивает какие провайдеры
включить, какие skills (browser, canvas, …) активировать:

```bash
make openclaw-onboard
```

Можно пропустить — gateway работает и без onboarding, но без skills
агенты не получат tool-use.

## Шаг 7. Зарегистрировать gateway в MC

В UI: `http://127.0.0.1:7012/gateways` → **Add Gateway**:

| Поле | Значение |
|---|---|
| Name | `primary` |
| Host | `host.docker.internal` |
| Port | `18789` |
| Token | (содержимое `OPENCLAW_GATEWAY_TOKEN` из `.env`) |
| Is primary | ✓ |

Сохранить. В течение 60 секунд `Gateway Agent Sync` цикл MC опросит
`/healthz`, статус строки в БД сменится на `online`. С этого момента
`isGatewayAvailable()` в task-dispatch.ts возвращает `true` →
**dispatch автоматически переключается на gateway-путь**.

## Шаг 7.5. Auto-pair MC's CLI с gateway (один раз)

OpenClaw защищается pairing-флоу: каждый CLI-клиент должен быть
пара-approve'нут операторским токеном с `operator.admin` scope. У нас
такого admin-paired клиента нет, и в headless cross-container topology
обычный `openclaw devices approve` не отрабатывает.

Решение — `make openclaw-pair-mc`:

```bash
make openclaw-pair-mc
```

Что это делает (один shot, идемпотентно):
1. Триггерит из MC контейнера один `openclaw gateway call health` —
   создаёт pending request на gateway.
2. Запускает `scripts/openclaw-auto-pair.py` который **транзакционно
   патчит filesystem state**: pending request → paired entry с полным
   operator-scope, pairing-token копируется в MC's
   `~/.openclaw/identity/device-auth.json`. Это безопасно потому что
   pairing-токены — просто 32-байтовые base64url случайные секреты,
   без подписи (см. `openclaw-src/src/infra/pairing-token.ts`).
3. Прописывает в MC `agents.config.openclawId` маппинг с display name
   («Architect (Claude Opus)») на openclaw agent id («architect»),
   декларированный в `openclaw.json`.
4. Verifies через повторный `openclaw gateway call health`.

После этого MC's CLI помнит pairing в bind-mounted `./.mc-openclaw/`
volume → переживает container restart / dev-rebuild.

Откатить пару: `make openclaw-unpair-mc CONFIRM=yes`.

> Доступность можно проверить вручную:
> ```bash
> curl -fsS -H "Authorization: Bearer $(make openclaw-token)" http://127.0.0.1:18789/healthz
> ```

## Шаг 8. Проверить что dispatch ходит через gateway

В `make dev-logs`:
```
Dispatching task to gateway agent ...
```
вместо
```
Dispatching task via Claude CLI
```

Поле `tasks.metadata.dispatch_session_id` теперь будет содержать gateway
session UUID (раньше был claude-CLI session id) — открыть таб **Session**
у карточки и увидишь live PTY stream от агента, а не статичный jsonl.

## Шаг 9. Pipelines в UI заработают

`Orchestration` → tab `Templates` → создать template с `agent_role`,
`task_prompt`, `model`. Затем tab `Pipelines` → склеить templates → Start.
Каждый шаг будет проходить через gateway, в `pipeline_runs.steps_snapshot`
видно состояние pending → running → completed.

## Откат

```bash
make openclaw-down
```

MC моментально (≤60с, на следующем `Gateway Agent Sync`) увидит, что
`/healthz` не отвечает, статус gateway-row в БД пометится как stale, и
`isGatewayAvailable()` вернёт `false` → dispatch снова идёт через
direct API/CLI. Никаких правок в MC config не нужно.

Полное удаление с очисткой:
```bash
make openclaw-down
docker volume rm mission-control_openclaw-plugin-runtime-deps
rm -rf ./.openclaw-data ./openclaw-src
# и убери OPENCLAW_GATEWAY_TOKEN из .env (или оставь — без gateway он не используется)
```

## Диагностика

| Симптом | Команда | Что искать |
|---|---|---|
| Gateway не стартует | `make openclaw-logs` | стек ошибок node, чаще всего недостающие провайдер-ключи |
| MC всё ещё идёт через direct API | `make dev-logs` | строка `isGatewayAvailable()` — должна быть `true` после Add Gateway. Если `false` — проверь что строка `gateways` имеет `status='online'` (не `unknown`). |
| `spawn openclaw ENOENT` в MC | — | значит `OPENCLAW_GATEWAY_HOST` указывает не туда. На Linux Docker Engine `host-gateway` маппинг должен работать; проверь `docker exec mission-control-dev getent hosts host.docker.internal` |
| Задача висит in_progress | `make openclaw-logs` + Session-таб | смотри что делает агент в gateway-сессии; можно прервать через `openclaw chat` CLI |
| Доктор | `make openclaw-doctor` | официальный диагностический отчёт openclaw |

## Что **не** требуется править

- `docker-compose.yml` (production MC) — не трогается.
- `docker-compose-dev.yml` — не трогается.
- `Dockerfile`, `Dockerfile.dev` — не трогаются.
- Код MC — все правки в `task-dispatch.ts` (CLI-фолбек, isGatewayAvailable
  strictness, scoreAgentForTask, requeueStaleTasks-skip-direct) **сохраняются
  как safety net**: если openclaw недоступен, MC деградирует на direct path
  плавно.

## Источник истинной правды

- README openclaw: https://github.com/openclaw/openclaw#readme
- Docker docs: https://docs.openclaw.ai/install/docker
- Architecture: https://docs.openclaw.ai/concepts/architecture
- Gateway protocol: https://docs.openclaw.ai/reference/rpc
- Конфиг: `.openclaw-data/openclaw.json` (smотрите вживую после первого старта)
