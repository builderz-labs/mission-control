# Control Engine v1

**Version**: 1.0.0
**Date**: 2026-05-04
**Status**: Developer reference for the current in-repo control engine.

## Purpose

Mission Control Control Engine v1 is the read-only decision layer for evaluating whether an agent may attempt a command. It does not execute commands, mutate state, write to a database, or make network calls. Its job is to return a deterministic verdict plus enough trace data for callers to explain why the verdict was produced.

## Pipeline

Conceptually, the control engine is made of these stages:

1. `Command Contract`
2. `Argument Guard`
3. `Coordination`
4. `Risk Composition`
5. `Execution Gate`
6. `Session Risk`
7. `Decision Trace`
8. `Control Interface`

### Stage summary

| Stage | Responsibility |
|---|---|
| `Command Contract` | Reject commands that are not registered in the command contract. |
| `Argument Guard` | Reject invalid or blocked arguments for otherwise known commands. |
| `Coordination` | Apply agent-level rules such as mode, blocked commands, allowed commands, and approval requirements. |
| `Risk Composition` | Combine agent risk and command risk into one `effective_risk_level`. |
| `Execution Gate` | Orchestrate the evaluation and produce the final `GateVerdict`. |
| `Session Risk` | Optionally accumulate risk across a caller-provided session chain. |
| `Decision Trace` | Return structured stage outcomes so callers can inspect how the decision was made. |
| `Control Interface` | Provide the stable public entry point that callers should use. |

## Public Entry Point

Use:

```ts
evaluateControl(input)
```

Input shape:

```ts
{
  agentId: string
  command?: string
  session?: SessionState
  options?: ValidateOptions
}
```

`evaluateControl(input)` currently forwards directly to the execution gate and returns the `GateVerdict` unchanged.

## What Developers Should Use

- Use `evaluateControl(input)` as the single entry point for command evaluation.
- Treat the returned `GateVerdict` as the source of truth for allow/block decisions.
- Pass `session` only when you want cumulative session risk tracking across multiple evaluations.
- Read `decision_trace` when you need to explain or debug a verdict.

## Do Not Bypass

- Do not call `checkExecutionGate()` directly from product-facing code when the control interface is available.
- Do not call `validateCommand()` directly as a substitute for a full control decision.
- Do not call coordination or session helpers directly to assemble your own allow/block policy.
- Do not skip the contract or argument checks just because a command “looks safe.”
- Do not import `src/lib/execution-gate.ts` directly from feature code.
- Do not import `src/lib/command-contract.ts` directly from feature code.
- Do not import `src/lib/execution-session.ts` directly from feature code.
- Use `evaluateControl()` from `src/lib/control-interface.ts` as the public entry point instead.

## Example Input / Output

Example call:

```ts
const verdict = evaluateControl({
  agentId: 'repo-steward',
  command: 'git status',
})
```

Example result:

```ts
{
  allowed: true,
  reason: 'OBSERVE_ONLY agent may report and read.',
  risk_level: 0,
  effective_risk_level: 0,
  command_intent: 'read',
  command_risk_profile: 'low',
  decision_trace: {
    contract: 'PASS',
    argument_guard: 'PASS',
    coordination: 'ALLOW',
    risk_composition: 'ALLOW',
    session: 'N/A',
  },
}
```

No-command example:

```ts
evaluateControl({ agentId: 'repo-steward' })
```

In that case, `decision_trace.contract` and `decision_trace.argument_guard` are both `"N/A"`.

## Safety Rules

- The control engine must remain side-effect free.
- A verdict is not execution authorization by itself; callers must still decide whether to act on the result.
- Unknown commands must be rejected by contract rather than allowed through coordination.
- `blocked_commands` always win over `allowed_commands`.
- High-risk outcomes must be surfaced through `effective_risk_level`, approval checks, and `decision_trace`.
- Session risk is caller-owned state; the engine evaluates it but does not persist it.

## Current Limitations

- The command contract is static and repo-defined.
- Session state is in-memory only and must be passed explicitly by the caller.
- The control interface is currently a thin wrapper and does not yet add version negotiation or request normalization.
- The engine evaluates eligibility only; it does not schedule, execute, or audit actual command runs.

## Future Work

- Add versioned control-interface contracts if the external API needs to stabilize across multiple clients.
- Add richer docs around how `effective_risk_level` maps to approvals and escalation policy.
- Add dedicated API or CLI adapters that depend on `evaluateControl()` instead of internal modules.
- Expand decision-trace documentation with more blocked and escalated examples.
