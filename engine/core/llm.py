"""Central LLM Factory — resolves LLM_MODE and returns the right client.

LLM_MODE=cli  -> Claude Code CLI pipe mode (Max subscription, $0 cost)
LLM_MODE=api  -> ChatOpenAI via LiteLLM proxy (costs API credits)

All model access goes through get_model(). Nothing else imports ChatOpenAI.
All direct CLI calls go through claude_cli_call().

Process spawning uses asyncio.create_subprocess_exec (no shell, safe).
"""
import asyncio
import logging
from typing import Any

from config import settings

logger = logging.getLogger("roceos.llm")

CLI_MODEL_MAP = {
    "reasoning": "opus",
    "analysis": "sonnet",
    "fast": "haiku",
}

API_MODEL_MAP = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6-20250929",
    "opus": "claude-opus-4-6-20250929",
}


def get_model(tier: str) -> Any:
    """Get a LangChain-compatible chat model for the given tier.

    Used by LangGraph graphs that need tool calling.
    Both modes use ChatOpenAI pointed at LiteLLM proxy for LangGraph compatibility.
    """
    from langchain_openai import ChatOpenAI
    model_name = getattr(settings, f"model_{tier}", settings.model_analysis)
    return ChatOpenAI(
        model=model_name,
        base_url=f"{settings.litellm_base_url}/v1",
        api_key="not-needed",
        streaming=True,
    )


async def claude_cli_call(
    prompt: str,
    system_prompt: str = "",
    model: str = "haiku",
    tools: str = "",
    timeout: int = 120,
) -> str:
    """Direct Claude CLI call for non-graph operations.

    Uses Max subscription ($0). Falls back to API if CLI fails.
    Spawns via asyncio.create_subprocess_exec (safe, no shell).

    Args:
        prompt: User message
        model: "haiku", "sonnet", or "opus" (or tier name)
        system_prompt: Prepended to prompt
        tools: Comma-separated tool names ("Bash,Read,WebFetch")
        timeout: Max seconds

    Returns:
        Response text
    """
    cli_model = CLI_MODEL_MAP.get(model, model)
    full_input = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt

    cmd = ["claude", "-p", "--model", cli_model, "--max-turns", "5"]
    if tools:
        cmd.extend(["--allowedTools", tools])

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=full_input.encode()),
            timeout=timeout,
        )

        if proc.returncode != 0:
            error = stderr.decode().strip()[:200]
            if "401" in error or "authentication" in error.lower():
                logger.warning(f"CLI auth failed, falling back to API")
                return await _api_fallback(full_input, model)
            raise RuntimeError(f"CLI error: {error}")

        return stdout.decode().strip()

    except asyncio.TimeoutError:
        logger.error(f"CLI timeout ({timeout}s) for model={cli_model}")
        try:
            proc.kill()
        except Exception:
            pass
        return await _api_fallback(full_input, model)
    except FileNotFoundError:
        logger.error("Claude CLI not found, falling back to API")
        return await _api_fallback(full_input, model)


async def _api_fallback(prompt: str, model: str = "haiku") -> str:
    """Fallback to Anthropic API when CLI fails. Costs money."""
    api_key = getattr(settings, "anthropic_api_key", "")
    if not api_key:
        return "[LLM unavailable: CLI failed, no API key configured]"

    import httpx
    api_model = API_MODEL_MAP.get(model, "claude-haiku-4-5-20251001")

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": api_model,
                    "max_tokens": 2048,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if resp.status_code == 200:
                logger.warning(f"Used API fallback (costs money!) model={model}")
                return resp.json()["content"][0]["text"]
            return f"[API fallback failed: {resp.status_code}]"
    except Exception as e:
        return f"[All LLM providers failed: {e}]"
