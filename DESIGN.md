# Design System — Helix Mission Control

> Fuente de verdad de diseño del fork. Deriva del canon de marca **Solar Throne**
> (`helix-ecosystem/docs/BRAND.md`, Musa + Council 2026-06-27). Este archivo ADAPTA
> ese canon al sistema de tokens de MC (shadcn/HSL vars); no lo sustituye.
> Consulta de diseño: design-consultation 2026-07-11 (HLX-290), screenshots base en
> el PR de Fase 2.

## Product Context

- **Qué es:** cabina de operación del ecosistema Helix (crons, agentes, skills, metas, GitHub) — fork de mission-control.
- **Para quién:** Musa (operador único, ADHD, consulta desktop + celular vía Tailscale).
- **Tipo:** dashboard interno denso, dark-first.
- **Lo memorable** (forcing question): *puente de mando — oro que arde sobre negro*. Cada decisión sirve a eso.

## Aesthetic Direction

- **Dirección:** Solar Throne (Industrial/Utilitarian + Retro-Futurista contenido). Negro-galaxia domina (~80% gris), color solo como señal (~20%).
- **Decoración:** intentional — glow SOLO en marca y KPIs; nada de gradientes decorativos, blobs ni chrome que no informa (Tufte: data-ink).
- **Mood:** cabina seria y caliente. Star Wars × mission control, NO caricatura. RPG sutil: máx 1 toque por vista (regla HLX-217).
- **Racional (por qué doubling down y no dirección nueva):** el canon existe, fue deliberado por Council y está aplicado en Status Hub + vault. Divergir aquí fragmentaría la identidad del ecosistema — coherencia inter-superficie > novedad.

## Color (mapeo Solar Throne → tokens HSL de MC)

Solo el tema `.dark` (MC es dark-first; light queda upstream sin marca).

| Token MC | HSL | Hex origen | Rol |
|---|---|---|---|
| `--background` | `249 28% 5%` | `#0a0910` | fondo galaxia |
| `--card` / `--popover` | `251 32% 10%` | `#141121` | superficies |
| `--foreground` | `255 26% 82%` | `#cbc5dd` | texto |
| `--muted-foreground` | `254 24% 65%` | `#9a90bb` | secundario |
| `--border` / `--input` | `256 34% 17%` | `#251d3b` | líneas |
| `--primary` / `--ring` | `42 89% 64%` | `#f5c451` | **oro solar — IDENTIDAD** (marca, títulos, foco). NO semántico |
| `--secondary` / `--muted` / `--accent` | `251 30% 13%` | `#0e0c18`± | rellenos tenues |
| `--destructive` | `351 100% 71%` | `#ff6b81` | coral — solo problemas reales |
| `--success` / `--void-mint` | `155 71% 58%` | `#46e0a0` | verde — sano/destacar |
| `--warning` / `--void-amber` | `42 87% 55%` | `#f0b429` | ámbar — te-necesita (único que pulsa) |
| `--info` / `--void-cyan` | `216 100% 71%` | `#6aa6ff` | azul — interactivo/dato |
| `--void-violet` | `255 92% 76%` | `#a78bfa` | morado — estado AUTONOMÍA ("la IA actuó sola") |
| `--void-crimson` | `351 100% 71%` | `#ff6b81` | coral |

Reglas duras del canon: oro ≠ ámbar (identidad vs alerta, tokens separados) · morado nunca para links · coral nunca decorativo · el color es acento, no relleno.

## Typography — híbrido intencional (decisión Musa 11-jul, opción B)

**Regla:** `font-mono` (JetBrains Mono) es el DEFAULT del `<body>` — identidad de
cabina en todo el chrome, headers, labels, KPIs, tablas de datos, IDs y timestamps.
El **texto de lectura larga** usa `font-sans` (Inter) PUNTUAL para no perder
legibilidad ni densidad:

- Objetivos de crons (panel Sistema)
- Triggers de capacidades (panel Sistema)
- Nombre + "por qué" de quests
- Títulos de PRs (panel GitHub) y de artefactos

Por qué híbrido y no mono-total: la mono se ve increíble en datos/cabina pero cuesta
densidad y comodidad en párrafos (objetivos de crons pasan de 3 a 4 líneas — evidencia
en el before/after de HLX-290). El sans queda como excepción marcada, no como default.

Nuevos textos de lectura larga → marcarlos `font-sans` explícito. Todo lo demás hereda
mono. `tabular-nums` obligatorio en toda métrica. Mínimo absoluto 12.5px. Labels y
headers de sección: MAYÚSCULAS + tracking.

## Spacing & Density

- Grid **8pt** (Tailwind default); densidad objetivo Linear/Grafana.
- Paneles: `p-4` máximo en contenedores; tablas `py-2` por fila; headers de página `text-lg` máx (no h1 display en vistas operativas).
- Home = vitales sin scroll en desktop 1440×900; progressive disclosure: overview → drill-down a un click.
- Móvil (~390px): sin scroll horizontal; tablas con scroll interno propio.

## Motion

Minimal-functional: transiciones de estado (hover, expand) ≤150ms. El ÚNICO pulso permitido = ámbar "te-necesita". Nada scroll-driven.

## Anti-patterns (prohibidos en este fork)

- Botón **Doctor Fix** en UI (eliminado — rompe config; prevención de error de Nielsen).
- Banners que empujan el contenido: avisos colapsan a una línea, detalle bajo demanda.
- Gradiente morado decorativo, badges flotantes que tapan contenido, gauges decorativos.
- Color como relleno; glow fuera de marca/KPI.

## Safe choices vs riesgos

- **Safe:** grid 8pt, shadcn primitives, semáforo semántico estándar, dark-first.
- **Riesgo 1 — oro como primary:** ningún dashboard de la categoría usa oro; es la firma. Costo: cuidar contraste AA sobre negro (oro 64% L pasa AA en texto grande/bold; para texto pequeño usar `--foreground`).
- **Riesgo 2 — monoespaciada total (bloque 2):** identidad terminal única; costo: legibilidad en prosa larga — por eso se gatea con OK explícito.

## Verificación

Cada pasada de UI: screenshots before/after desktop 1440×900 + móvil 390×844 (browse), `design-review` como QA, contraste AA en pares texto/fondo nuevos.
