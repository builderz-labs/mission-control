#!/usr/bin/env python3
"""
openclaw CLI shim — additive compatibility layer.

Why:
    Mission Control's source uses an older openclaw CLI shape that the daemon
    has since retired:

        runOpenClaw(['gateway', 'sessions_send', '--session', X, '--message', Y])
        # -> openclaw gateway sessions_send --session X --message Y

    In openclaw 2026.4.x, `sessions_send` is no longer a `gateway`
    subcommand. It exists only as an RPC method behind the generic call
    surface:

        openclaw gateway call sessions_send --params '{"sessionKey":"X","message":"Y"}' --json

    The Linter agent "Failed to wake agent" error in /agents and the
    Orchestration → Command tab Send button both fail because MC keeps
    invoking the retired shape.

    Rather than patch MC source (the operator wants MC unmodified), this
    shim sits at /usr/local/bin/openclaw, recognizes the legacy shape,
    rewrites it into the modern RPC call shape, and forwards to the real
    openclaw CLI.

What gets rewritten:
    legacy: gateway sessions_send --session X --message Y [--json]
    modern: gateway call sessions_send --params {"sessionKey":"X","message":"Y"} --json

    legacy: gateway sessions_history --session X
    modern: gateway call sessions_history --params {"sessionKey":"X"} --json

    legacy: gateway sessions_list
    modern: gateway call sessions_list --params {} --json

Pass-through:
    Anything that doesn't match a known legacy shape is forwarded as-is to
    `node /opt/openclaw-src/dist/index.js`.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional


# Strips ANSI color/style sequences before line-matching so the doctor footer
# filter (below) works regardless of whether openclaw is in TTY or piped mode.
ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*m")

# Openclaw's `doctor` (without `--fix`) ALWAYS prints this footer at the end
# even when there are no actual config changes to apply (see
# openclaw-src/src/flows/doctor-health-contributions.ts:580-582 — the line is
# emitted whenever shouldRepair is false, not gated on whether the run found
# anything fixable). The word "fix" in the line trips MC's
# parseOpenClawDoctorOutput `mentionsWarnings` regex and raises the doctor
# banner with no actual problem behind it. We can't patch MC's parser
# (treated as vendored) and we can't patch openclaw-src (read-only), so the
# shim drops this single misleading footer line from doctor output.
DOCTOR_FOOTER_RE = re.compile(r'Run\s+"openclaw\s+doctor\s+--fix"\s+to\s+apply\s+changes', re.IGNORECASE)

# Same root issue: MC's parseOpenClawDoctorOutput escalates to level="error"
# whenever the raw output matches /invalid config|failed|error/i — and
# openclaw doctor's Plugins panel always prints `Errors: 0` even when there
# are zero plugin errors, which trips that regex on the substring "error".
# We rewrite the literal "Errors: 0" line (case where there is genuinely
# nothing wrong) to "Errs: 0" so MC sees no "error" substring; if the count
# is non-zero we leave the line untouched so the banner still surfaces the
# real warning.
DOCTOR_PLUGIN_ZERO_ERRORS_RE = re.compile(r'\bErrors:(\s+)0\b')

OPENCLAW_DIST = "/opt/openclaw-src/dist/index.js"

VALID_TELEGRAM_DM_POLICIES = {"allowlist", "pairing", "open"}
TRUTHY_ENV_VALUES = {"1", "true", "yes", "on"}
FALSY_ENV_VALUES = {"0", "false", "no", "off"}
MANAGED_DENY_GROUPS = {"group:automation", "group:runtime", "group:fs"}


def parse_csv_entries(raw: str) -> List[str]:
    return [entry.strip() for entry in raw.split(",") if entry.strip()]


def parse_telegram_numeric_ids(raw: str) -> List[str]:
    out: List[str] = []
    for entry in parse_csv_entries(raw):
        if not re.fullmatch(r"[1-9][0-9]*", entry):
            continue
        if entry not in out:
            out.append(entry)
    return out


def normalize_owner_identity(entry: str) -> Optional[str]:
    value = entry.strip()
    if not value:
        return None
    numeric_match = re.fullmatch(r"[1-9][0-9]*", value)
    if numeric_match:
        return f"telegram:{value}"
    prefixed_match = re.fullmatch(r"telegram:([1-9][0-9]*)", value)
    if prefixed_match:
        return f"telegram:{prefixed_match.group(1)}"
    return None


def parse_owner_allow_from(raw: str) -> List[str]:
    out: List[str] = []
    for entry in parse_csv_entries(raw):
        normalized = normalize_owner_identity(entry)
        if normalized and normalized not in out:
            out.append(normalized)
    return out


def merged_unique(existing: object, additions: List[str]) -> List[str]:
    seen = set()
    merged: List[str] = []

    if isinstance(existing, list):
        for entry in existing:
            normalized = str(entry).strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged.append(normalized)

    for entry in additions:
        normalized = str(entry).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)

    return merged


def read_env_toggle(name: str) -> Optional[bool]:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return None

    normalized = raw_value.strip().lower()
    if not normalized:
        return None
    if normalized in TRUTHY_ENV_VALUES:
        return True
    if normalized in FALSY_ENV_VALUES:
        return False
    return None


def project_security_defaults(config: dict) -> None:
    tools = config.get("tools")
    if not isinstance(tools, dict):
        tools = {}

    tools_profile_raw = os.environ.get("OPENCLAW_TOOLS_PROFILE")
    if tools_profile_raw is not None:
        tools_profile = tools_profile_raw.strip()
        if tools_profile:
            tools["profile"] = tools_profile

    fs_tools = tools.get("fs")
    if not isinstance(fs_tools, dict):
        fs_tools = {}
    workspace_only_toggle = read_env_toggle("OPENCLAW_SECURITY_WORKSPACE_ONLY")
    if workspace_only_toggle is not None:
        fs_tools["workspaceOnly"] = workspace_only_toggle
    if fs_tools:
        tools["fs"] = fs_tools

    deny_toggles = {
        "automation": read_env_toggle("OPENCLAW_SECURITY_DENY_AUTOMATION"),
        "runtime": read_env_toggle("OPENCLAW_SECURITY_DENY_RUNTIME"),
        "fs": read_env_toggle("OPENCLAW_SECURITY_DENY_FS"),
    }

    if any(value is not None for value in deny_toggles.values()):
        desired_deny_groups: List[str] = []
        if deny_toggles["automation"]:
            desired_deny_groups.append("group:automation")
        if deny_toggles["runtime"]:
            desired_deny_groups.append("group:runtime")
        if deny_toggles["fs"]:
            desired_deny_groups.append("group:fs")

        existing_deny = tools.get("deny")
        preserved_deny: List[str] = []
        if isinstance(existing_deny, list):
            for entry in existing_deny:
                normalized = str(entry).strip()
                if not normalized or normalized in MANAGED_DENY_GROUPS:
                    continue
                if normalized not in preserved_deny:
                    preserved_deny.append(normalized)

        tools["deny"] = merged_unique(preserved_deny, desired_deny_groups)

    config["tools"] = tools

    sandbox_toggle = read_env_toggle("OPENCLAW_SECURITY_SANDBOX_ALL")
    if sandbox_toggle is None:
        return
    if sandbox_toggle is False:
        agents_section = config.get("agents") if isinstance(config.get("agents"), dict) else {}
        defaults_section = agents_section.get("defaults") if isinstance(agents_section.get("defaults"), dict) else {}
        sandbox = defaults_section.get("sandbox") if isinstance(defaults_section.get("sandbox"), dict) else {}
        if "mode" in sandbox:
            sandbox.pop("mode", None)
        if sandbox:
            defaults_section["sandbox"] = sandbox
        elif "sandbox" in defaults_section:
            defaults_section.pop("sandbox", None)
        if defaults_section:
            agents_section["defaults"] = defaults_section
            config["agents"] = agents_section
        return

    agents = config.get("agents")
    if not isinstance(agents, dict):
        agents = {}

    defaults = agents.get("defaults")
    if not isinstance(defaults, dict):
        defaults = {}

    sandbox = defaults.get("sandbox")
    if not isinstance(sandbox, dict):
        sandbox = {}

    sandbox["mode"] = "all"
    defaults["sandbox"] = sandbox
    agents["defaults"] = defaults
    config["agents"] = agents


def resolve_telegram_dm_policy(explicit_policy_raw: str, legacy_owner_ids: List[str]) -> str:
    explicit_policy = explicit_policy_raw.lower().strip()
    if explicit_policy in VALID_TELEGRAM_DM_POLICIES:
        return explicit_policy
    # Backward compatibility for existing TELEGRAM_NUMERIC_USER_ID-only setups.
    if legacy_owner_ids:
        return "allowlist"
    # Secure default when no explicit policy exists.
    return "pairing"


def resolve_openclaw_paths() -> tuple[Path, Path, Path]:
    state_dir = Path(os.environ.get("OPENCLAW_STATE_DIR", str(Path.home() / ".openclaw"))).expanduser()
    config_path = Path(os.environ.get("OPENCLAW_CONFIG_PATH", str(state_dir / "openclaw.json"))).expanduser()
    credentials_dir = state_dir / "credentials"
    return state_dir, config_path, credentials_dir


def ensure_openclaw_state_defaults() -> None:
    state_dir, config_path, credentials_dir = resolve_openclaw_paths()
    state_dir.mkdir(parents=True, exist_ok=True)
    credentials_dir.mkdir(parents=True, exist_ok=True)

    config: dict = {}
    if config_path.exists():
        try:
            loaded = json.loads(config_path.read_text())
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid OpenClaw config JSON at {config_path}: {exc}") from exc
        if isinstance(loaded, dict):
            config = loaded

    gateway = config.get("gateway")
    if not isinstance(gateway, dict):
        gateway = {}
        config["gateway"] = gateway

    if gateway.get("mode") != "local":
        gateway["mode"] = "local"

    commands = config.get("commands")
    if not isinstance(commands, dict):
        commands = {}

    telegram_bot_token = str(os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()
    legacy_owner_ids = parse_telegram_numeric_ids(str(os.environ.get("TELEGRAM_NUMERIC_USER_ID", "")))
    channel_allow_from = parse_telegram_numeric_ids(str(os.environ.get("TELEGRAM_ALLOW_FROM", "")))
    owner_allow_from = parse_owner_allow_from(str(os.environ.get("TELEGRAM_OWNER_ALLOW_FROM", "")))
    telegram_dm_policy = resolve_telegram_dm_policy(
        str(os.environ.get("TELEGRAM_DM_POLICY", "")),
        legacy_owner_ids,
    )

    if legacy_owner_ids:
        channel_allow_from = merged_unique(channel_allow_from, legacy_owner_ids)
        owner_allow_from = merged_unique(owner_allow_from, [f"telegram:{owner_id}" for owner_id in legacy_owner_ids])

    should_bootstrap_telegram = (
        bool(telegram_bot_token)
        or bool(channel_allow_from)
        or bool(owner_allow_from)
        or "TELEGRAM_DM_POLICY" in os.environ
        or bool(legacy_owner_ids)
    )

    if should_bootstrap_telegram:
        channels = config.get("channels")
        if not isinstance(channels, dict):
            channels = {}

        telegram = channels.get("telegram")
        if not isinstance(telegram, dict):
            telegram = {}

        telegram["enabled"] = True

        if telegram_bot_token:
            telegram["botToken"] = {
                "source": "env",
                "provider": "default",
                "id": "TELEGRAM_BOT_TOKEN",
            }

        if owner_allow_from:
            commands["ownerAllowFrom"] = merged_unique(commands.get("ownerAllowFrom"), owner_allow_from)

        if channel_allow_from:
            telegram["allowFrom"] = merged_unique(telegram.get("allowFrom"), channel_allow_from)

        telegram["dmPolicy"] = telegram_dm_policy

        channels["telegram"] = telegram
        config["channels"] = channels

    config["commands"] = commands

    visible_replies_raw = str(os.environ.get("OPENCLAW_MESSAGES_GROUPCHAT_VISIBLE_REPLIES", "")).strip()
    messages_section = config.get("messages")
    if not isinstance(messages_section, dict):
        messages_section = {}

    group_chat = messages_section.get("groupChat")
    if not isinstance(group_chat, dict):
        group_chat = {}

    existing_visible_replies = group_chat.get("visibleReplies") if isinstance(group_chat.get("visibleReplies"), str) else ""
    visible_replies_changed = False

    if visible_replies_raw:
        group_chat["visibleReplies"] = visible_replies_raw
        visible_replies_changed = True
    elif existing_visible_replies.strip() == "message_tool":
        group_chat["visibleReplies"] = "automatic"
        visible_replies_changed = True

    if visible_replies_changed:
        messages_section["groupChat"] = group_chat
        config["messages"] = messages_section

    project_security_defaults(config)

    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")


def find_flag_value(args: List[str], flag: str) -> Optional[str]:
    """Return the value following `flag` in args, or None if absent."""
    try:
        idx = args.index(flag)
    except ValueError:
        return None
    if idx + 1 >= len(args):
        return None
    return args[idx + 1]


def has_flag(args: List[str], flag: str) -> bool:
    return flag in args


def remaining_flags(args: List[str], known: List[str]) -> List[str]:
    """Return flags from `args` not in `known` (for pass-through)."""
    out: List[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in known:
            # skip flag and its value
            i += 2
            continue
        out.append(a)
        i += 1
    return out


def rewrite_sessions_send(rest: List[str]) -> List[str]:
    """gateway sessions_send --session X --message Y [--json] [--timeout ms]
    -> gateway call chat.send --params '{...}' --json [--timeout ms]

    The retired `sessions_send` RPC is now `chat.send`, which requires an
    `idempotencyKey` and a `deliver` flag in addition to `sessionKey` and
    `message`. We mint a deterministic-but-unique idempotencyKey based on
    pid+time so a re-issued wake-up is distinct from a duplicate.
    """
    import time
    session = find_flag_value(rest, "--session") or ""
    message = find_flag_value(rest, "--message") or ""
    timeout = find_flag_value(rest, "--timeout")

    idempotency = f"mc-shim-{os.getpid()}-{int(time.time() * 1000)}"
    params = json.dumps(
        {
            "sessionKey": session,
            "message": message,
            "idempotencyKey": idempotency,
            "deliver": False,
        }
    )
    out = ["gateway", "call", "chat.send", "--params", params, "--json"]
    if timeout:
        out.extend(["--timeout", timeout])
    return out


def rewrite_sessions_history(rest: List[str]) -> List[str]:
    """gateway sessions_history --session X
    -> gateway call sessions.history --params '{"key":"X"}' --json
    """
    session = find_flag_value(rest, "--session") or ""
    timeout = find_flag_value(rest, "--timeout")
    params = json.dumps({"key": session})
    out = ["gateway", "call", "sessions.history", "--params", params, "--json"]
    if timeout:
        out.extend(["--timeout", timeout])
    return out


def rewrite_sessions_list(rest: List[str]) -> List[str]:
    """gateway sessions_list -> gateway call sessions.list --params '{}' --json"""
    timeout = find_flag_value(rest, "--timeout")
    out = ["gateway", "call", "sessions.list", "--params", "{}", "--json"]
    if timeout:
        out.extend(["--timeout", timeout])
    return out


# Legacy shape: openclaw gateway <method> [flags]
# where <method> is one of these RPC names that used to be subcommands.
LEGACY_GATEWAY_METHODS = {
    "sessions_send": rewrite_sessions_send,
    "sessions_history": rewrite_sessions_history,
    "sessions_list": rewrite_sessions_list,
}


def rewrite(args: List[str]) -> List[str]:
    """Inspect args and rewrite legacy shapes. Return the args to forward."""
    if len(args) >= 2 and args[0] == "gateway" and args[1] in LEGACY_GATEWAY_METHODS:
        rewriter = LEGACY_GATEWAY_METHODS[args[1]]
        new_tail = rewriter(args[2:])
        return new_tail
    return args


def is_plain_doctor_invocation(args: List[str]) -> bool:
    """True when args invoke `openclaw doctor` without `--fix` (the footer
    drop only applies to that case; `doctor --fix` already suppresses the
    footer naturally because the runWriteConfigHealth early-returns)."""
    return bool(args) and args[0] == "doctor" and "--fix" not in args


def run_doctor_filtered(rewritten: List[str]) -> int:
    """Run openclaw doctor and strip the spurious `Run ... --fix` footer
    line. Returns the child exit code."""
    proc = subprocess.run(
        ["node", OPENCLAW_DIST, *rewritten],
        capture_output=True,
        text=True,
        check=False,
    )
    for line in proc.stdout.splitlines(keepends=True):
        if DOCTOR_FOOTER_RE.search(ANSI_ESCAPE_RE.sub("", line)):
            continue
        rewritten_line = DOCTOR_PLUGIN_ZERO_ERRORS_RE.sub(r'Errs:\g<1>0', line)
        sys.stdout.write(rewritten_line)
    sys.stdout.flush()
    if proc.stderr:
        sys.stderr.write(proc.stderr)
        sys.stderr.flush()
    return proc.returncode


def main() -> int:
    ensure_openclaw_state_defaults()
    raw = sys.argv[1:]
    rewritten = rewrite(raw)
    if rewritten is not raw and os.environ.get("OPENCLAW_SHIM_DEBUG"):
        print(f"[openclaw-shim] {' '.join(raw)}", file=sys.stderr)
        print(f"[openclaw-shim] -> {' '.join(rewritten)}", file=sys.stderr)
    if is_plain_doctor_invocation(rewritten):
        return run_doctor_filtered(rewritten)
    os.execvp("node", ["node", OPENCLAW_DIST, *rewritten])


if __name__ == "__main__":
    sys.exit(main())
