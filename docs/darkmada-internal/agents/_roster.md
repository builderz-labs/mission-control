# Agent Roster — DarkMada

| Agent | Role | Reports to | Primary model | Surfaces owned |
|---|---|---|---|---|
| [Helmy](helmy.md) | CEO — Executive Intelligence | Jackson | Claude Opus 4.7 | The Office, Org Chart, Approvals |
| [Thinky](thinky.md) | Execution Engine — Orchestrator | Helmy | Claude Sonnet 4.6 | Command Deck, Assembly Line |
| [Skywalker](skywalker.md) | Head of Engineering | Thinky | Claude Sonnet 4.6 | The Workshop |
| [Velma](velma.md) | Head of Research | Thinky | GPT-5 | Intelligence Room |
| [Dr Strange](dr-strange.md) | Head of Memory | Thinky | Claude Sonnet 4.6 | The Vault, The Library |
| [Seccy](seccy.md) | Head of Security | Helmy | Claude Sonnet 4.6 | Approvals (gates) |

**Hard rules**

1. Helmy is the only agent with a direct line to Jackson.
2. Thinky owns execution. Other agents do not dispatch work to each other; they request via Thinky.
3. Seccy reports to Helmy and can pause any lane unilaterally.
4. Every agent's persona, skills, and tool budget live in the Agent Context Interface (MCP service).
