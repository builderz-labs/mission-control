# Образцовый пример: команда из 3 провайдеров (Claude + OpenAI + Local) в Mission Control

Демо-сценарий для оператора. Поднимает 4 агентов на трёх провайдерах, прогоняет одну master-задачу через декомпозицию → реализацию → линт → ревью.

> **Все названия кнопок, поля форм и значения — копировать-вставлять.** Если что-то в UI у тебя называется иначе — отметь в разделе 13, обновлю.

---

## 0. Подготовка

### 0.1. `.env` в корне проекта

Создай (или допиши) файл `beads/discovered/mission-control/.env`:

```dotenv
# Порт для Makefile (по умолчанию 7012)
MC_PORT=7012

# Anthropic — для architect и aegis
ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI — для implementor (dev)
OPENAI_API_KEY=sk-...

# Local LLM (LMStudio дефолт). Замени на свою модель.
LOCAL_LLM_ENDPOINT=http://host.docker.internal:1234/v1
LOCAL_LLM_API_KEY=

# Race policy для shared host claude sessions
MC_HOST_SESSION_MODE=coexist

# Админ — заполни если хочешь сразу зайти без /setup
AUTH_USER=admin
AUTH_PASS=admin123
```

### 0.2. LMStudio — поднять на хосте

1. Запусти LMStudio на хосте.
2. Загрузи модель — рекомендую `qwen2.5-coder-7b-instruct` или `qwen2.5-7b-instruct` (помещаются в 16GB RAM).
3. Перейди на вкладку **Server** (значок 🖥 слева в LMStudio).
4. Нажми **Start Server** — порт 1234 по умолчанию.
5. **Запиши точный API Identifier** загруженной модели — его видно в верхней строке Server tab (например `qwen2.5-coder-7b-instruct`). Этот id пойдёт в config агента.

Проверь что MC видит LMStudio:

```bash
docker exec mission-control sh -c 'curl -sS http://host.docker.internal:1234/v1/models'
```

Если возвращает JSON с твоей моделью — всё ок.

### 0.3. Поднять MC

```bash
cd beads/discovered/mission-control
make recreate     # пересоздаст контейнер с новым .env
```

Дождись `✓ http://127.0.0.1:7012 → 200`.

### 0.4. Войти

1. Открой **http://127.0.0.1:7012/setup** — если сюда редиректнуло, создай админа (или используй `AUTH_USER`/`AUTH_PASS` из `.env`).
2. После логина окажешься на дашборде (`/overview`).

---

## 1. Workspace — рекомендация: пропустить, использовать `default`

> **Важно.** На странице `/super-admin` форма `Create New Workspace` использует OpenClaw template provisioning через env `MC_SUPER_TEMPLATE_OPENCLAW_JSON`. На Linux без OpenClaw создание нового workspace **зависнет в `Pending`** или упадёт с ошибкой:
> `Missing OpenClaw template config. Set MC_SUPER_TEMPLATE_OPENCLAW_JSON to an openclaw.json to seed new tenants.`
>
> Поскольку у нас direct-API path (без OpenClaw), **проще оставаться в дефолтном workspace** — он уже видим как `Active Orgs: 1` на той же странице. Все шаги ниже (project, agents, task) работают в нём.
>
> Если всё-таки хочешь создать отдельный workspace — см. **раздел 1.A** в конце.

Чтобы убедиться что используется default:

1. В верхнем правом углу (header-bar) — селектор текущего workspace. Если там одно значение или ничего — ты уже в дефолтном.
2. Перейти в `/super-admin` → блок Active Orgs покажет «1». Это и есть наш default.

Можешь сразу перейти к **разделу 2 (Project)**.

### 1.A. Создание нового workspace (если есть OpenClaw template)

Только если ты собираешься заполнить `MC_SUPER_TEMPLATE_OPENCLAW_JSON` — иначе **этот блок пропустить**.

1. Сайдбар → иконка super-admin → `/super-admin`.
2. Сверху справа — кнопка **`+ Add Workspace`**. Кликни — раскроется форма `Create New Workspace`.
3. Реальные поля формы (8 шт):

| #  | Поле (placeholder)         | Тип       | Что вводить                                              |
|----|----------------------------|-----------|----------------------------------------------------------|
| 1  | (slug)                     | text      | `multi-provider-demo` — URL-safe идентификатор           |
| 2  | (display name)             | text      | `Multi-Provider Demo` — человеко-читаемое имя            |
| 3  | (linux user)               | text      | `uadmin` — твой хост-юзер (на скриншоте именно `uadmin`) |
| 4  | Owner Gateway              | dropdown  | `primary (primary)` — единственный pre-seeded gateway    |
| 5  | (tier / profile)           | dropdown  | `Standard`                                               |
| 6  | Gateway port               | text      | оставь пустым (auto)                                     |
| 7  | Dashboard port             | text      | оставь пустым (auto)                                     |
| 8  | Dry-run                    | checkbox  | ☐ снять (если включить — provisioning не выполнится)     |

4. Кнопка **`Create + Queue`** (не просто `Create`!). Она поставит provisioning в очередь.
5. **Только если** `MC_SUPER_TEMPLATE_OPENCLAW_JSON` указывает на валидный openclaw.json — статус новой строки в `Pending / In Progress` сменится на `Active`. Иначе застрянет.

> Для этого demo **не делай** этот шаг. Default workspace покрывает все нужды.

---

## 2. Project (для тикет-префикса и группировки задач)

1. В левом сайдбаре кликни иконку **Tasks** — откроется `/tasks` Kanban.
2. В верхней панели Tasks найди кнопку **`Projects`** (outline-вариант). Кликни.
3. Откроется модальное окно **`Project Management`** (× в правом верхнем углу для закрытия).

### 2.1. Создать проект — top-bar форма

В самом верху модала **3 поля + 1 кнопка** в одну строку:

| #   | Поле                | Тип    | Значение                            |
|-----|---------------------|--------|-------------------------------------|
| 1   | (project name)      | text   | `Refactor Login Flow`               |
| 2   | (ticket prefix)     | text   | `LOGIN`                             |
| 3   | (—)                 | button | **`Add Project`**                   |

Под этой строкой — **отдельное поле Description** (textarea на всю ширину):

```
Migrate session-cookie auth to JWT. Demo project for multi-provider team.
```

Нажми **`Add Project`**.

### 2.2. После создания — раскрыть и доконфигурить (опционально)

Под top-bar формой в этом же модале — **список существующих проектов**. После клика `Add Project` твой `Refactor Login Flow` появится там как карточка с заголовком `Refactor Login Flow` (1 tasks) → `LOGIN · <slug> · active`.

Кликни на карточку — раскроется блок с дополнительными полями:

| Поле                | Тип            | Что вводить                                                    |
|---------------------|----------------|----------------------------------------------------------------|
| Description         | textarea       | (уже сохранено из шага 2.1, при желании можно отредактировать) |
| GitHub Repo         | text `owner/repo` | оставь пустым или впиши `nnnet/mission-control` если работаешь с реальным репо |
| Deadline            | date `mm/dd/yyyy` | оставь пустым                                                |
| Color               | 8 цветных точек | выбери любой (например синий — для UI-маркера)                |
| Assigned Agents     | chip selector  | пока не трогай — назначим агентов в шаге 7 на уровне задачи    |

Нажми **`Save`**. (Или `Cancel` если ничего не менял.)

### 2.3. Закрой модал

Кликни **`×`** в правом верхнем углу или нажми Esc. Возвращаешься на `/tasks`.

---

## 3. Агент №1 — Architect (Claude Opus)

### 3.1. Открыть форму создания

1. В левом сайдбаре кликни иконку **Agents** — откроется `/agents` (`Agent Squad`).
2. Найди кнопку **`+ Create Agent`** (или просто `Create Agent`) — обычно в верхней строке панели.
3. Откроется **трёхшаговый wizard** `Create New Agent`.

### 3.2. Step 1 — Template (выбор шаблона)

В верхнем прогресс-баре wizard'а: `1 Template` → `2 Configure` → `3 Review`.

Покажет 7 карточек:

| Шаблон             | Emoji | Tier   | Tools | Theme |
|--------------------|-------|--------|-------|-------|
| Orchestrator       | 🧭    | Opus   | 23    | operator strategist |
| Developer          | 🛠️   | Sonnet | 21    | builder engineer |
| Specialist Dev     | ⚙️    | Sonnet | 15    | specialist developer |
| Reviewer / QA      | 🔬    | Haiku  | 7     | quality reviewer |
| **Researcher**     | 🔍    | Sonnet | 8     | research analyst |
| Content Creator    | ✏️    | Haiku  | 9     | content creator |
| Security Auditor   | 🛡️   | Sonnet | 10    | security auditor |

Выбери **`Researcher`**. Wizard перейдёт на Step 2 «Configure».

### 3.3. Step 2 — Configure (точные названия полей и опций)

В форме сверху вниз:

| Лейбл (как в UI)         | Тип       | Значение для architect                               | Опции / placeholder |
|--------------------------|-----------|------------------------------------------------------|---------------------|
| Display Name (или Name)  | text      | `Architect (Claude Opus)`                            | поле сверху wizard'а; ID автоматически сгенерится из этого как `architect-claude-opus` (kebab-case) |
| **Role Theme**           | text      | `architect`                                          | placeholder `builder engineer` |
| **Emoji**                | text      | `🏛️`                                                 | placeholder `e.g. 🛠️` |
| **Tier**                 | 3-button toggle | **`Opus $$$`** (нажми кнопку — подсветится) | другие: `Sonnet $$`, `Haiku $` |
| **Primary Model**        | text input + autocomplete | `anthropic/claude-opus-4-5`            | автозаполнится при выборе Tier; можно править вручную |
| **Workspace** *(dropdown)* | select    | `None`                                               | другие: `Read & Write`, `Read-only` |
| **Sandbox** *(dropdown)*   | select    | `Non-main sessions`                                  | другие: `All sessions` |
| **Network** *(dropdown)*   | select    | `Isolated`                                           | другие: `Bridge` |
| **Session Key (Optional)** | text     | (оставь пустым)                                      | placeholder `e.g. agent:my-agent:main` |

Нажми **`Next`** (внизу справа, между `Back` и `Cancel`).

### 3.4. Step 3 — Review

Wizard показывает сводку карточкой: emoji иконка, заголовок (`Architect (Claude Opus)`), Role (`architect`), и блок свойств:

```
ID: architect-claude-opus    Template: Researcher
Model: Opus $$$              Tools: 8
Primary Model: anthropic/claude-opus-4-5
Workspace: none              Sandbox: non-main
Network: none
```

Под сводкой — **2 чекбокса** (точные названия с UI):

| Чекбокс              | Состояние   | Почему                              |
|----------------------|-------------|-------------------------------------|
| `Add to gateway`     | ☐ снять     | у нас нет OpenClaw gateway          |
| `Provision Workspace`| ☐ снять     | то же самое                         |

Нажми **`Create Agent`** (cyan-кнопка между `Back` и `Cancel`).

Wizard закрывается, агент появляется в списке `/agents`.

### 3.5. После создания — задать Soul

1. В списке агентов (`/agents`) найди `architect-claude`. Кликни на карточку.
2. Откроется детальная страница агента с вкладками. Найди вкладку **`Soul`** (рядом с Overview/Activity/Config/...).
3. В текстовом поле **вставь полный текст** (копируй блок ниже целиком):

```
You are an experienced software architect. Your job is to break a single
high-level task into 3-7 atomic implementation tasks.

For each subtask output exactly:
  TITLE: <one-line title>
  DESCRIPTION: <what to do, 2-4 sentences>
  ACCEPTANCE: <how to verify, 1-2 bullets>
  ESTIMATE: <hours, integer>

Do not write code. Do not explain your approach. Only the structured list.
Number subtasks 1, 2, 3, ...
```

4. Нажми **`Save Soul`** (или просто `Save` если кнопка одна).

### 3.6. dispatchModel НЕ нужен для Anthropic

Шаблон уже задал `model.primary = anthropic/claude-opus-4-5`. Anthropic — дефолтный путь, дополнительный override не требуется. **Пропусти Config tab edit.**

---

## 4. Агент №2 — Implementor (OpenAI gpt-4o-mini)

### 4.1. Step 1 — Template

`/agents` → **`+ Create Agent`** → выбери **`Developer`** (🛠️, theme `builder engineer`, Sonnet, 21 tools).

### 4.2. Step 2 — Configure

| Лейбл                    | Значение                              |
|--------------------------|---------------------------------------|
| Display Name             | `Dev (OpenAI)`                        |
| Role Theme               | `developer`                           |
| Emoji                    | `⚙️`                                  |
| Tier                     | `Sonnet $$` (override на OpenAI зададим потом через Config tab) |
| Primary Model            | `anthropic/claude-sonnet-4-20250514` (оставь как есть) |
| Workspace                | `Read & Write`                        |
| Sandbox                  | `All sessions`                        |
| Network                  | `Bridge` (dev может качать deps)      |
| Session Key (Optional)   | (пусто)                               |

`Next`. На Step 3 Review:

| Чекбокс              | Состояние |
|----------------------|-----------|
| `Add to gateway`     | ☐         |
| `Provision Workspace`| ☐         |

`Create Agent`.

Step 3 → **Create**.

### 4.3. Soul

Кликни на агента → tab **`Soul`** → вставь:

```
You implement code changes. Reply with file paths and unified diffs only.
No prose. No explanations. No "here is the code" preamble.

Format:
  --- a/<path> ---
  <full file content if new>

  *** edit a/<path> ***
  <unified diff with @@ markers>

If the task is unclear, reply with one line:
  CLARIFY: <single specific question>
```

Save.

### 4.4. ⚠ Важно — задать `dispatchModel = openai/gpt-4o-mini`

Шаблон Developer проставляет Anthropic-модель. Чтобы маршрутизация пошла в OpenAI — нужно переопределить через `dispatchModel` поле в config агента.

#### Вариант A: через UI (Config tab)

> Если Config tab падает с ошибкой `Something went wrong / React error #31` — это известный баг рендеринга в детальной карточке (см. ниже Вариант B). Используй API-путь.

1. На странице агента → tab **`Config`**.
2. Кнопка **`JSON`** в правом верхнем углу карточки — переключает режим в JSON-редактор.
3. Нажми **`Edit`**. JSON станет редактируемым.
4. **Добавь** поле `dispatchModel` в корень объекта (рядом с `model`, `sandbox`, `tools`):

```json
{
  "model": {
    "primary": "anthropic/claude-sonnet-4-20250514",
    "fallbacks": [...]
  },
  "sandbox": { "mode": "all", "workspaceAccess": "rw", "docker": { "network": "bridge" } },
  "tools": { "allow": [...], "deny": [...] },
  "dispatchModel": "openai/gpt-4o-mini"
}
```

(остальные поля **не трогать** — только добавить `dispatchModel`).

5. **`Save`**.
6. Префикс `openai/` обязателен — он триггерит маршрутизацию на `OPENAI_API_KEY` в `task-dispatch.ts`.

#### Вариант B: через API (если UI падает)

Получи API key в `/settings` → `API Keys` → `+ Generate Key`. Затем:

```bash
# 1. Найди id агента
curl -sS http://127.0.0.1:7012/api/agents \
  -H "x-api-key: $MC_API_KEY" | jq '.agents[] | select(.name=="Dev (OpenAI)") | {id, name, config}'

# 2. Получи текущий config (для merge)
curl -sS http://127.0.0.1:7012/api/agents/<AGENT_ID> \
  -H "x-api-key: $MC_API_KEY" | jq '.agent.config'

# 3. PATCH/PUT config с новым dispatchModel (точный endpoint смотри в /docs)
curl -X PATCH http://127.0.0.1:7012/api/agents/<AGENT_ID> \
  -H "x-api-key: $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"config":{"dispatchModel":"openai/gpt-4o-mini","model":{"primary":"anthropic/claude-sonnet-4-20250514"},"sandbox":{"mode":"all","workspaceAccess":"rw","docker":{"network":"bridge"}}}}'
```

Проверь:

```bash
curl -sS http://127.0.0.1:7012/api/agents/<AGENT_ID> \
  -H "x-api-key: $MC_API_KEY" | jq '.agent.config.dispatchModel'
# должно вернуть: "openai/gpt-4o-mini"
```

#### Что должно произойти

При следующем dispatch'е задачи на этого агента — в `make logs` появится `Dispatching task via direct openai`, и в `/cost-tracker` модель будет `gpt-4o-mini`.

---

## 5. Агент №3 — Linter (Local LMStudio)

### 5.1. Step 1 — Template

`/agents` → **`+ Create Agent`** → выбери **`Reviewer / QA`** (🔬, theme `quality reviewer`, Haiku, 7 tools, read-only).

### 5.2. Step 2 — Configure

| Лейбл                    | Значение                              |
|--------------------------|---------------------------------------|
| Display Name             | `Linter (Local LLM)`                  |
| Role Theme               | `linter`                              |
| Emoji                    | `✨`                                  |
| Tier                     | `Haiku $`                             |
| Primary Model            | (оставь дефолт `anthropic/claude-haiku-4-5` — override через Config tab) |
| Workspace                | `Read-only`                           |
| Sandbox                  | `All sessions`                        |
| Network                  | `Isolated`                            |
| Session Key (Optional)   | (пусто)                               |

`Next` → Review → оба чекбокса ☐ → **`Create Agent`**.

Step 3 → **Create**.

### 5.3. Soul

```
You only suggest lint/format/style fixes. Skip semantic changes.
Reply with bullet list of fixes:
  - <file>:<line> — <fix description>

If nothing to fix, reply:
  CLEAN
```

Save.

### 5.4. dispatchModel — указать LMStudio модель

Аналогично 4.4 (через UI или API):

```json
{
  "dispatchModel": "local/qwen2.5-coder-7b-instruct"
}
```

> Замени `qwen2.5-coder-7b-instruct` на **точный API Identifier** из LMStudio Server tab (см. шаг 0.2 пункт 5).

Префикс `local/` (или `lmstudio/`/`ollama/`/`litellm/`) триггерит маршрутизацию на `LOCAL_LLM_ENDPOINT`.

---

## 6. Агент №4 — Aegis (Claude Sonnet, reviewer)

> Aegis может уже быть создан системой автоматически (имя `aegis` в default workspace). Проверь в `/agents`. Если есть — открой его, обнови Soul по шаблону ниже и пропусти создание. Если нет — создавай.

### 6.1. Создание (если нет)

`/agents` → **`+ Create Agent`** → Step 1 Template: **`Reviewer / QA`** (🔬).

Step 2 Configure:

| Лейбл                    | Значение                              |
|--------------------------|---------------------------------------|
| Display Name             | `Aegis`                               |
| Role Theme               | `reviewer`                            |
| Emoji                    | `🛡️`                                  |
| Tier                     | `Sonnet $$` (переопредели если шаблон поставил Haiku) |
| Primary Model            | `anthropic/claude-sonnet-4-20250514`  |
| Workspace                | `Read-only`                           |
| Sandbox                  | `Non-main sessions`                   |
| Network                  | `Isolated`                            |
| Session Key (Optional)   | (пусто)                               |

`Next` → Review → оба чекбокса ☐ → **`Create Agent`**.

### 6.2. Soul (формат строгий — MC парсит ответ)

```
You are Aegis, the quality reviewer.

Evaluate the agent's resolution against the acceptance criteria.

Reply with EXACTLY one of these two formats:

If acceptable:
VERDICT: APPROVED
NOTES: <one-line summary>

If needs fix:
VERDICT: REJECTED
NOTES: <specific issues to fix>
```

Save.

### 6.3. dispatchModel — оставь Anthropic (нужен дефолт)

Sonnet shaблon уже даёт `anthropic/claude-sonnet-4-20250514`. Anthropic — дефолтный путь. **Config edit не нужен.**

---

## 7. Master-задача

1. В левом сайдбаре кликни **Tasks** (📋) — `/tasks`.
2. В верхней панели Kanban-доски кнопка **`+ New Task`** (или `Add Task`) — кликни.
3. Откроется форма создания задачи. Заполни:

| Поле               | Значение                                                                    |
|--------------------|-----------------------------------------------------------------------------|
| `Title`            | `Migrate /api/auth/login from session cookies to JWT`                       |
| `Project`          | (dropdown) `Refactor Login Flow (LOGIN)`                                    |
| `Assigned To`      | (dropdown) `architect-claude`                                               |
| `Priority`         | `high`                                                                      |
| `Estimated Hours`  | `8`                                                                         |
| `Tags`             | `auth, refactor, jwt`                                                       |
| `Status`           | `backlog` (оставь по умолчанию)                                             |
| `Description`      | (см. блок ниже)                                                             |

Description — копируй полный текст:

```
Replace cookie-based session auth with JWT in the /api/auth/login endpoint.

Current state:
- /api/auth/login sets a session cookie via NextResponse.cookies.set('session', token)
- Server reads this cookie to authenticate subsequent /api/* requests
- Cookie is httpOnly + Secure + SameSite=Lax
- Session token is stored in `sessions` table, looked up by id

Goal:
- /api/auth/login returns { token: string, expiresAt: number } in the JSON body
- Token is a signed JWT (use existing AUTH_SECRET as HS256 signing key)
- Subsequent requests authenticate via Authorization: Bearer <token> header
- Drop the `sessions` table dependency entirely
- Keep /api/auth/logout working (now stateless: client just discards the token)

Constraints:
- All existing E2E tests must still pass after refactor
- Backward compatibility for ONE release: accept BOTH cookie and Bearer header
  during the deprecation window
- Document the migration in CHANGELOG.md

Decompose into 3-7 atomic subtasks. For each, give acceptance criteria
the implementor agent can verify locally before marking done.
```

Кнопка **`Create`** (или `Save`).

---

## 7.A. Про "Owner" и колонку "Awaiting Owner"

В MC у задачи **нет отдельного поля Owner** в форме создания/редактирования. Есть только `Assigned To` — агент-исполнитель (ты выбрал `architect-claude`).

Колонка **`Awaiting Owner`** в Task Board — это автоматический статус для задач, требующих **человеческого вмешательства** (PM, оператор). MC выставляет его в трёх случаях:

- **Aegis reject** — рецензент отклонил resolution → задача ждёт что человек разберётся и решит дальше делать.
- **Метки/теги** в title или description (`owner action`, `human required`, `blocked on owner`, `awaiting human`, `needs owner`) — детектится в `detectAwaitingOwner()`.
- **Manual drag** — ты сам перетаскиваешь карточку в колонку `Awaiting Owner`. Status станет `awaiting_owner`.

**Что это значит на практике для нашего демо:**
- На старте все задачи в `Backlog`. После назначения агенту → `Assigned`.
- При drag в `In Progress` агент работает. При rejection от Aegis (или ручном drag в `Awaiting Owner`) — задача ожидает тебя.
- Когда ты сам обработал и хочешь вернуть в работу — drag из `Awaiting Owner` обратно в `In Progress` или `Backlog`.

**Если нужен полноценный «owner» как отдельное поле** (например, в виде «менеджер этой задачи = vasya, исполнитель = agent-X»), это потребует апстрим-доработки MC: добавить колонку `owner` в schema + поле в task form. На этой ветке этого нет.

## 8. Запустить конвейер

### 8.1. Architect декомпозирует

1. На `/tasks` Kanban найди карточку `Migrate /api/auth/login...` в колонке **`Backlog`**.
2. **Перетащи мышью** в колонку **`In Progress`**. (Или открой карточку → Status dropdown → `in_progress`.)
3. Через ~30-90с (Opus думает) карточка обновится. Кликни на неё.
4. В детальном виде поле **`Resolution`** будет содержать список из 3-7 пронумерованных пунктов в формате TITLE/DESCRIPTION/ACCEPTANCE/ESTIMATE.

**Где смотреть прогресс:**
- Карточка задачи (live-обновляется через polling/SSE).
- В терминале: `make logs | grep -i dispatch` — увидишь `Dispatching task via direct anthropic`.
- `/cost-tracker` (левый сайдбар) — строка с `claude-opus-4-5` и потраченными токенами.

### 8.2. Раскладка подзадач (вручную, ~3 мин)

Открой `Resolution` master-задачи. Для **каждой** подзадачи:

1. `/tasks` → **`+ New Task`**.
2. Поля:
   - `Title`: `LOGIN-N: <TITLE из resolution>` (например `LOGIN-1: Add JWT sign helper`)
   - `Project`: `Refactor Login Flow (LOGIN)`
   - `Assigned To`: `dev-openai`
   - `Priority`: `medium` (или `high` если ESTIMATE > 4h)
   - `Tags`: `auth, jwt, subtask`
   - `Description`: **скопируй блок DESCRIPTION + ACCEPTANCE из вывода architect**
3. `Create`.

> Если есть желание — автоматизировать через CLI: `node scripts/mc-cli.cjs tasks create ...` (см. `docs/cli-agent-control.md`).

### 8.3. Dev пишет код

Перетащи каждую `LOGIN-N` подзадачу из `Backlog` → `In Progress`.
- Implementor (gpt-4o-mini) обработает за ~10-30с/задачу.
- Resolution каждой подзадачи: список файлов + unified diff'ы.
- В `/cost-tracker`: модель `gpt-4o-mini`.
- В `make logs`: `Dispatching task via direct openai`.

### 8.4. Linter (опционально, показывает работу local LLM)

Для каждой готовой dev-задачи создай **linter-задачу**:

1. `+ New Task`:
   - `Title`: `Lint LOGIN-N output`
   - `Assigned To`: `linter-local`
   - `Description`: вставь diff из `LOGIN-N` resolution + строка `Suggest only style/lint fixes.`
2. Перетащи в `In Progress`.
3. **Открой LMStudio Server tab** → должна появиться запись запроса в Server logs.
4. Resolution = bullet list или `CLEAN`.

### 8.5. Aegis ревью

> Aegis запускается **автоматически** каждые 60с по задачам в статусе `review` (см. `runAegisReviews` в `src/lib/task-dispatch.ts`).

Перетащи каждую dev-задачу из `In Progress` → **`Review`**.

В течение 60с:
- Aegis получит задачу, прочитает `description` (acceptance criteria) и `resolution`, вернёт `VERDICT: APPROVED` или `VERDICT: REJECTED`.
- **Если APPROVED** → задача → `Done`.
- **Если REJECTED** → задача → обратно в `In Progress`, `error_message` содержит NOTES от Aegis.

`/cost-tracker`: модель `claude-sonnet-4-20250514`.

---

## 9. Чек-лист приёмки

После 5-15 минут активной работы конвейера:

| Проверка                         | Где                          | Ожидание                                                                 |
|----------------------------------|------------------------------|--------------------------------------------------------------------------|
| 4 агента онлайн                  | `/agents`                    | 4 строки, last_seen свежий                                                |
| Master декомпозирована           | `/tasks/<master-id>`         | Resolution содержит 3-7 пронумерованных TITLE/DESCRIPTION/ACCEPTANCE/ESTIMATE |
| Подзадачи созданы                | `/tasks` Kanban              | Колонки заполнены, все assigned `dev-openai`                              |
| Dev-задачи имеют diff            | `/tasks/<id>`                | Resolution содержит unified diff                                          |
| Linter работает                  | LMStudio Server tab → Logs    | Хотя бы 1 POST `/v1/chat/completions`                                     |
| Aegis verdicts                   | `/tasks/<id>`                | Resolution или комментарий: `VERDICT: APPROVED` или `REJECTED`            |
| Cost tracker — три провайдера    | `/cost-tracker`              | Anthropic + OpenAI (+ local = $0)                                         |
| Логи dispatch                    | `make logs`                  | Есть строки `direct anthropic`, `direct openai`, `direct local`           |

---

## 10. Troubleshooting

### LMStudio не отвечает / `local API 404`

```bash
docker exec mission-control sh -c 'curl -sS http://host.docker.internal:1234/v1/models | head'
```

- 404 → LMStudio не на 1234.
- timeout → LMStudio не запущена / firewall.
- пустой `data` → загрузи модель в LMStudio Server tab.

### `OPENAI_API_KEY not set` в логах

`.env` не подхватился. Сделай **`make recreate`** (не просто `restart`).

### Aegis не запускается

Aegis сканирует задачи в `review` каждые 60с. Подожди или жми `make logs | grep -i aegis`. Если совсем тишина — проверь что у агента `aegis` есть Soul и `dispatchModel` (или Anthropic дефолт).

### Architect отвечает обычным текстом, не структурированно

Soul слишком "softный". Усиль: добавь в начало `OUTPUT EXACTLY THIS FORMAT, NO PROSE`. Понизь temperature через JSON Config.

### dispatchModel `local/...` падает с timeout

LMStudio долго грузит модель в память на первом запросе (5-30с). Сделай warmup: пинг через curl или просто запрос-другой через LMStudio chat.

### Не знаю свой LMStudio model id

```bash
docker exec mission-control sh -c 'curl -sS http://host.docker.internal:1234/v1/models' | python3 -c 'import json,sys;[print(m["id"]) for m in json.load(sys.stdin)["data"]]'
```

Покажет точные id всех моделей. Используй один из них (с префиксом `local/`).

### Кнопки `+ Create Agent` нет

Проверь что текущий workspace выбран (header-bar). Если ты в `read-only` workspace — переключись на свой.

### Кнопки `Projects` нет на /tasks

Возможно UI обновился. Проверь правый верхний угол панели Tasks. Также форма создания проектов может быть в `/super-admin` → секция `Projects`.

---

## 11. Что менять для своего сценария

**Ollama вместо LMStudio:**
```dotenv
LOCAL_LLM_ENDPOINT=http://host.docker.internal:11434/v1
```
Префикс агента `ollama/<model>` или `local/<model>`.

**liteLLM proxy для нескольких backend'ов:**
```yaml
# docker-compose.yml — добавь сервис litellm рядом с mission-control
litellm:
  image: ghcr.io/berriai/litellm:main-latest
  ports: ["4000:4000"]
  environment:
    - LITELLM_MASTER_KEY=sk-litellm-master-key
  volumes:
    - ./litellm-config.yaml:/app/config.yaml
```

В `.env`:
```dotenv
LOCAL_LLM_ENDPOINT=http://litellm:4000
LOCAL_LLM_API_KEY=sk-litellm-master-key
```

В Config агента `dispatchModel = litellm/<routing-name>`.

**Только Anthropic + OpenAI (без local):**
Не задавай `LOCAL_LLM_ENDPOINT`, не используй `local/*` префиксы. Удали агент `linter-local`.

**Только Anthropic:**
Не задавай `OPENAI_API_KEY`. Удали `dev-openai`. Замени роль на `dev-claude` с шаблоном Developer и Sonnet.

---

## 12. Полезные команды

```bash
# Полный лог сервера
make logs

# Только dispatch события
make logs | grep -i "Dispatching task"

# Перезапуск с применением .env
make recreate

# Сбросить БД и начать с нуля (внимание: удалит всех агентов и задачи)
make reset-db

# Проверить статус контейнера
make status

# Войти в shell контейнера
make shell

# Внутри контейнера: проверить env vars
env | grep -E "ANTHROPIC|OPENAI|LOCAL_LLM|MC_HOST"

# Внутри контейнера: проверить что claude binary на месте
which claude && claude --version
```

---

## 13. Открытые вопросы (отметь если что-то не сошлось)

Подтверждённые (исправлено в файле):
- [x] Workspace форма — кнопка `Create + Queue`, 8 полей (см. раздел 1).
- [x] Project — кнопка `Add Project` + раскрывающаяся карточка для GitHub/Color/Deadline (см. раздел 2).
- [x] Agent wizard — 3 шага: Template / Configure / Review. Поля Step 2: Display Name, Role Theme, Emoji, Tier (3-button), Primary Model, Workspace (None/RW/RO), Sandbox (All/Non-main sessions), Network (Isolated/Bridge), Session Key. Step 3: Add to gateway / Provision Workspace + кнопка `Create Agent`.

Ещё открыто:
- [ ] Tab `Soul` — точно так называется в детальном виде агента? Или `Personality`/`Identity`?
- [ ] Tab `Config` с JSON editor — существует, и формат как в моём шаблоне?
- [ ] `Add Project` → раскрытие карточки existing project — кликом по карточке или иначе?
- [ ] LMStudio model id в моей системе: ___________
- [ ] При drag в `Review` колонку — Aegis действительно срабатывает в течение 60с?
- [ ] `dispatchModel` в JSON config сохраняется после reload агента?
- [ ] Workspace селектор в header-bar — есть или MC работает только с одним workspace?

Если что-то не совпадает — пометь, обновлю файл.
