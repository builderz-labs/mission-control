"""RoceOS CLI Engine v2 — with LLM failover.

Uses llm_failover for resilient LLM access:
  claude-cli (Max subscription, $0) → anthropic-api → openai-api

Config at /opt/llm-config.json controls provider selection.
"""
import asyncio
import json
import logging
import re

from config import settings
from skillsets import SKILLSET_REGISTRY
from llm_failover import llm_call

logger = logging.getLogger("roceos.cli_engine")

# Skillset tool permissions for claude -p
SKILLSET_TOOLS = {
    "it_ops": "Bash,Read,WebFetch,Grep",
    "cto": "Bash,Read,Write,Edit,WebFetch,Grep,Glob",
    "trading": "Bash,Read,WebFetch,Grep",
    "security": "Bash,Read,WebFetch,Grep",
    "ttrpg": "Read,Write,Grep,Glob",
    "general": "Read,WebFetch,WebSearch,Grep",
    "wealth": "Read,WebFetch,Grep",
    "legal": "Read,WebFetch,Grep",
    "household": "Read,WebFetch,Grep,Glob",
    "homelab": "Bash,Read,WebFetch,Grep",
    "recreation": "Read,WebFetch",
}


MODEL_MAP = {
    "reasoning": "opus",
    "analysis": "sonnet",
    "fast": "haiku",
}


async def process_message_cli(
    message: str,
    skillset: str = "general",
    thread_id: str = None,
) -> str:
    """Process a message using LLM failover (Max subscription primary, API fallback)."""
    config = SKILLSET_REGISTRY.get(skillset) or SKILLSET_REGISTRY.get("general")
    if not config:
        return "Engine not ready."

    cli_model = MODEL_MAP.get(config.model_tier, "haiku")

    try:
        tools = SKILLSET_TOOLS.get(skillset, "Read,WebFetch")
        response = await llm_call(
            prompt=message,
            system_prompt=config.system_prompt or "",
            model=cli_model,
            tools=tools,
        )
        logger.info(f"LLM response for {skillset} ({cli_model}): {len(response)} chars")
        return response or "No response generated."

    except Exception as e:
        logger.error(f"LLM failover exception for {skillset}: {e}")
        return f"Error: {str(e)[:200]}"


async def classify_intent_cli(message: str) -> dict:
    """Classify intent using LLM failover."""
    prompt = (
        'You are a message router. Output ONLY raw JSON.\n'
        'Classify which team handles this message.\n'
        'Output: {"skillsets":["<id>"],"confidence":0.9}\n'
        'Teams: general, wealth, cto, ttrpg, it_ops, legal, trading, '
        'security, household, homelab, recreation\n\n'
        f'Message: {message}'
    )

    try:
        text = await llm_call(prompt=prompt, model="haiku")
        match = re.search(r'\{[^{}]*"skillsets?"[^{}]*\}', text)
        if match:
            data = json.loads(match.group(0))
            skillsets = data.get("skillsets", data.get("skillset", ["general"]))
            if isinstance(skillsets, str):
                skillsets = [skillsets]
            valid = {"general", "wealth", "cto", "ttrpg", "it_ops", "legal",
                     "trading", "security", "household", "homelab", "recreation"}
            skillsets = [s for s in skillsets if s in valid] or ["general"]
            return {"skillsets": skillsets, "confidence": data.get("confidence", 0.8),
                    "multi": len(skillsets) > 1}

        return {"skillsets": ["general"], "confidence": 0.5, "multi": False}

    except Exception as e:
        logger.warning(f"CLI router failed: {e}")
        return {"skillsets": ["general"], "confidence": 0.0, "multi": False}
