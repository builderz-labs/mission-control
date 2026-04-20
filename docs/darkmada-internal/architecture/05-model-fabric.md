# 05 — Model Fabric

Three providers, two tiers. Thinky picks per task. Local first when latency or privacy matters; cloud frontier
when judgment or recency is required.

## Registry

| Model | Provider | Tier | Best for | Cost |
|---|---|---|---|---|
| Qwen 3.5 32B | Ollama | local | Local reasoning, code review | free |
| GLM 4.6 | Ollama | local | Long-form drafting, summarization | free |
| Nemotron 70B | Ollama | local | Tool calling, structured output | free |
| MiniMax 2.5 | Ollama | local | Multimodal, fast iteration | free |
| Claude Opus 4.7 | Anthropic | cloud-frontier | Helmy — strategy, judgment, sensitive comms | $$$ |
| Claude Sonnet 4.6 | Anthropic | cloud-fast | Default agent workhorse — code, planning | $$ |
| GPT-5 | OpenAI | cloud-frontier | Velma — research synthesis, alt perspective | $$$ |

## Routing rules (Thinky)

1. **If** the task carries sensitive data → local model only.
2. **If** the task is approval-bound exec comms → Claude Opus 4.7.
3. **If** the task is research synthesis → GPT-5 with Claude Sonnet for second pass.
4. **Else** → Claude Sonnet 4.6 with Qwen 3.5 fallback.
5. **Always** log the chosen model + reason into the run record.

## Cost discipline

- Daily spend budget per agent enforced by Thinky.
- Hitting 80% of budget triggers a Telegram nudge to Jackson.
- Hitting 100% switches the agent to local-only for the rest of the day.
- Spend by agent + model is visible in Command Deck.

## Local model strategy

- Ollama runs on the **Mainframe** account. Models pinned, never auto-upgraded.
- New model versions are tested in a parallel Ollama instance and promoted by Skywalker.
- The Mainframe account has no direct internet access (NAT-isolated through Founder LAN).
