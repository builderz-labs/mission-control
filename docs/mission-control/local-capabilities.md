# Local Capabilities

**Version**: 1.0.0
**Date**: 2026-05-04
**Status**: Developer reference for observe-only local capability detection.

## Purpose

Mission Control can inspect which local coding and model tools are present without automatically using them. This is an observe-only inventory step intended to inform routing, debugging, and operator decisions.

## Entry Point

Run:

```bash
pnpm mc:capabilities
```

This executes:

```bash
node scripts/local-capabilities.cjs
```

## Detected Tools

The v1 capability registry checks:

- `Node`
- `pnpm`
- `Git`
- `GitHub CLI`
- `PowerShell`
- `Aider`
- `Ollama`
- installed `Ollama` models

Future candidates such as Claude Code, Codex CLI, LM Studio, and OpenRouter-compatible CLIs are intentionally not auto-detected in v1.

## Output Contract

The script emits a single JSON object:

```json
{
  "agent": "Local Capabilities v1",
  "label": "OBSERVE ONLY",
  "status": "PASS",
  "checked_at": "2026-05-04T00:00:00.000Z",
  "critical_missing": [],
  "important_missing": [],
  "optional_missing": [],
  "capabilities": {
    "ollama": {
      "available": true,
      "version": "ollama version is 0.x.x",
      "models": ["llama3.2:latest"]
    }
  },
  "warnings": [],
  "recommended_actions": []
}
```

## Safety Rules

- No installs
- No model pulls
- No network calls
- No credential output
- No command execution beyond safe version and list checks

The only external command probes used in v1 are:

- current Node runtime version from `process.version`
- `pnpm --version`
- `git --version`
- `gh --version`
- `ollama --version`
- `ollama list`
- `aider --version`

## Intended Use

- Use this registry to decide whether local-model or local-coding workflows are even possible on the current machine.
- Use warnings to spot missing local dependencies before assigning tasks that depend on them.
- Do not treat this script as permission to invoke any detected tool automatically.

## Limitations

- PowerShell detection is environment-based in v1 rather than version-probed.
- Missing tools downgrade availability and add warnings, but do not crash the script.
- Future tool families are documented but not yet part of the live registry contract.

## Status Logic

- `FAIL` if any critical capability is missing: `node`, `pnpm`, or `git`
- `WARN` if all critical capabilities exist but an important capability is missing: `ollama` or `aider`
- `PASS` if only optional capabilities are missing
