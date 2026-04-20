# Integration — for OpenClaw, Helmy, and future agents

These documents are written so that an agent (OpenClaw, a future Helmy ingest pass, or any partner intelligence)
can read them and act with the right model of the system.

| Doc | What it tells the agent |
|---|---|
| [openclaw-system-brief.md](openclaw-system-brief.md) | One-pager: what the DarkMada is, what's live, what's not |
| [helmy-executive-role.md](helmy-executive-role.md) | How Helmy should think about itself and the system |
| [thinky-execution-role.md](thinky-execution-role.md) | How Thinky should orchestrate runs |
| [source-of-truth-rules.md](source-of-truth-rules.md) | Where truth lives; what is mirror; what is cache |
| [account-boundaries.md](account-boundaries.md) | What runs where; what each macOS account may do |
| [mcp-role.md](mcp-role.md) | How agents must use the MCP layer |

Format conventions: short, declarative, machine-readable section headings. Every doc starts with a 3-line
**Brief** block an agent can extract verbatim into its system prompt.
