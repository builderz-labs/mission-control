"""LLM Failover System for RoceOS + Captain Hook.

Resilient LLM access with automatic fallback:
1. Claude CLI pipe mode (Max subscription, $0) — PRIMARY
2. Anthropic API (API key, costs money) — FALLBACK
3. OpenAI API (API key, costs money) — EMERGENCY
4. Static response — LAST RESORT

Config at /opt/llm-config.json — editable to force a provider.
All subprocess calls use create_subprocess_exec (no shell injection risk).
"""
import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger("llm_failover")

CONFIG_PATH = Path("/opt/llm-config.json")

DEFAULT_CONFIG = {
    "provider": "auto",
    "anthropic_api_key": "",
    "openai_api_key": "",
    "claude_cli_model": "haiku",
    "anthropic_model": "claude-haiku-4-5-20251001",
    "openai_model": "gpt-4.1-mini",
    "timeout_seconds": 60,
    "last_failure": None,
    "last_success": None,
    "consecutive_failures": 0,
}

_config = None


def load_config() -> dict:
    global _config
    if CONFIG_PATH.exists():
        try:
            _config = json.loads(CONFIG_PATH.read_text())
            return _config
        except Exception:
            pass
    _config = DEFAULT_CONFIG.copy()
    save_config()
    return _config


def save_config():
    if _config:
        CONFIG_PATH.write_text(json.dumps(_config, indent=2))


def get_config() -> dict:
    if _config is None:
        return load_config()
    return _config


class AuthError(Exception):
    pass

class LLMError(Exception):
    pass


async def call_claude_cli(prompt: str, system_prompt: str = "", model: str = "haiku", timeout: int = 60, tools: str = "") -> str:
    cmd = ["claude", "-p", "--model", model, "--max-turns", "15", "--output-format", "json"]
    if tools:
        cmd.extend(["--allowedTools", tools])

    # Use --system-prompt-file for proper system/user separation
    # Prepending to stdin causes claude -p to output raw tool XML instead of executing
    import tempfile, os
    sys_prompt_file = None
    if system_prompt:
        sys_prompt_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, dir="/tmp")
        sys_prompt_file.write(system_prompt)
        sys_prompt_file.close()
        cmd.extend(["--system-prompt-file", sys_prompt_file.name])

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(
        proc.communicate(input=prompt.encode()), timeout=timeout,
    )
    if proc.returncode != 0:
        error = stderr.decode().strip()
        if "401" in error or "authentication" in error.lower():
            raise AuthError(f"OAuth expired: {error[:100]}")
        raise LLMError(f"CLI error: {error[:200]}")
    raw = stdout.decode().strip()
    # Parse JSON output to get clean result
    try:
        import json as _json
        data = _json.loads(raw)
        return data.get("result", raw)
    except (ValueError, KeyError):
        return raw


async def call_anthropic_api(prompt: str, system_prompt: str = "", model: str = None, api_key: str = None) -> str:
    import httpx
    cfg = get_config()
    key = api_key or cfg.get("anthropic_api_key")
    mdl = model or cfg.get("anthropic_model", "claude-haiku-4-5-20251001")
    if not key:
        raise LLMError("No Anthropic API key configured")

    messages = [{"role": "user", "content": prompt}]
    body = {"model": mdl, "max_tokens": 2048, "messages": messages}
    if system_prompt:
        body["system"] = system_prompt

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json=body,
        )
        if resp.status_code != 200:
            raise LLMError(f"Anthropic API {resp.status_code}: {resp.text[:200]}")
        return resp.json()["content"][0]["text"]


async def call_openai_api(prompt: str, system_prompt: str = "", model: str = None, api_key: str = None) -> str:
    import httpx
    cfg = get_config()
    key = api_key or cfg.get("openai_api_key")
    mdl = model or cfg.get("openai_model", "gpt-4.1-mini")
    if not key:
        raise LLMError("No OpenAI API key configured")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": mdl, "messages": messages, "max_tokens": 2048},
        )
        if resp.status_code != 200:
            raise LLMError(f"OpenAI API {resp.status_code}: {resp.text[:200]}")
        return resp.json()["choices"][0]["message"]["content"]


async def llm_call(prompt: str, system_prompt: str = "", model: str = "haiku", tools: str = "") -> str:
    """Resilient LLM call with automatic failover.

    Edit /opt/llm-config.json to control:
      "provider": "auto"           — try claude-cli, then API fallbacks
      "provider": "claude-cli"     — force CLI only ($0)
      "provider": "anthropic-api"  — force Anthropic API (costs $)
      "provider": "openai-api"     — force OpenAI (costs $)
      "provider": "disabled"       — return static message
    """
    cfg = get_config()
    provider = cfg.get("provider", "auto")

    if provider == "disabled":
        return "[LLM disabled via config]"

    if provider == "auto":
        order = ["claude-cli", "anthropic-api", "openai-api"]
    else:
        order = [provider]

    last_error = None
    for p in order:
        try:
            if p == "claude-cli":
                result = await call_claude_cli(prompt, system_prompt, model, cfg.get("timeout_seconds", 60), tools=tools)
            elif p == "anthropic-api":
                result = await call_anthropic_api(prompt, system_prompt)
            elif p == "openai-api":
                result = await call_openai_api(prompt, system_prompt)
            else:
                continue

            cfg["last_success"] = p
            cfg["consecutive_failures"] = 0
            save_config()
            if p != "claude-cli":
                logger.warning(f"LLM failover active: using {p} (costs money!)")
            return result

        except (AuthError, LLMError, asyncio.TimeoutError, Exception) as e:
            logger.error(f"LLM provider {p} failed: {e}")
            last_error = e
            continue

    cfg["last_failure"] = str(last_error)[:200]
    cfg["consecutive_failures"] = cfg.get("consecutive_failures", 0) + 1
    save_config()
    logger.critical(f"ALL LLM PROVIDERS FAILED: {last_error}")
    return f"[All LLM providers failed] {str(last_error)[:100]}"
