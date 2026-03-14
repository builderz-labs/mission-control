# Office Panel — Pixel Agent Office

## Vision
Replace the placeholder Office panel with a pixel art virtual office showing Watson's 8 agents as animated characters at desks. Agents visually reflect their state — typing when processing, idle when offline, walking when switching tasks.

## References
- [Pixel Agents](https://github.com/pablodelucca/pixel-agents) — VS Code extension, Claude Code focused. Good aesthetic.
- [Bit Office](https://github.com/longyangxi/bit-office) — Standalone pixel office for multi-agent teams. Closer to what we need — shows activity feed, team roster, task delegation. MIT licensed, Node 18+.

## Agents to Represent
1. **Watson** (main) — desk at center, always present
2. **Librarian** — desk near bookshelves
3. **Dispatch** — desk near door/inbox
4. **DoDo** — desk with VeeFriends branding
5. **Condor** — smaller desk (uses haiku, lighter work)
6. **Compass** — desk near compass/map
7. **Builder** — desk with tools/code
8. **Knowing Gnome** — desk with mushroom/garden theme

## Data Sources
- Agent heartbeat status from gateway (`/api/agents`)
- Active sessions from gateway WebSocket
- Current task from WatsonFlow
- Cron activity (typing animation when cron runs)

## MVP Scope
- Static pixel office background (tilemap)
- 8 character sprites with idle/working/offline states
- Status pulled from existing agent heartbeat API
- Click agent to see detail card (same data as Agents panel)

## Future
- Walking animations between desks
- Speech bubbles showing current task
- Day/night cycle based on real time
- Sound effects (optional, muted by default)
