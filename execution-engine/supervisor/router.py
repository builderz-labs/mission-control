"""PA Router — classifies user intent and routes to the correct skillset.

Uses the 'fast' model tier (Haiku) for cheap, fast classification.
Returns the skillset ID that should handle the query.
"""
import json
import logging
import re

from langchain_openai import ChatOpenAI
from config import settings

logger = logging.getLogger("roceos.router")

ROUTING_PROMPT = """You are a message router. Output ONLY raw JSON, no markdown, no code fences, no explanation.

Classify which team handles this message. Output format:
{"skillset":"<id>","confidence":<0.0-1.0>}

Teams:
- "wealth" — money, budget, spending, bills, debt, savings, income, accounts, Monarch, financial planning, discretionary budget, net worth, 401k, investments
- "cto" — code, software, GitHub, repos, deploy, Docker, build, architecture, DevOps, programming, infrastructure
- "ttrpg" — CY_BORG, tabletop RPG, campaign, NPCs, combat, dice, session prep, Wattana, Zola, Lucky Flight
- "general" — everything else: greetings, weather, general questions, topics without a dedicated team

IMPORTANT: Route to the specialist team when the topic clearly matches. "general" is the fallback only when no specialist fits."""


def _extract_json(text: str) -> dict:
    """Extract JSON from a response that might have code fences or extra text."""
    # Try raw parse first
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strip markdown code fences
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Find any JSON object in the text
    match = re.search(r'\{[^{}]*"skillset"[^{}]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return {}


async def classify_intent(message: str) -> dict:
    """Classify a message and return the target skillset.

    Returns:
        {"skillset": str, "confidence": float}
    """
    model = ChatOpenAI(
        model=settings.model_fast,
        base_url=f"{settings.litellm_base_url}/v1",
        api_key="not-needed",
        temperature=0,
        max_tokens=30,
    )

    try:
        response = await model.ainvoke([
            {"role": "system", "content": ROUTING_PROMPT},
            {"role": "user", "content": message},
        ])

        result = _extract_json(response.content)
        skillset = result.get("skillset", "general")
        confidence = result.get("confidence", 0.5)

        # Validate skillset is one we know
        valid = {"general", "wealth", "cto", "ttrpg"}
        if skillset not in valid:
            logger.warning(f"Unknown skillset '{skillset}', falling back to general")
            skillset = "general"

        logger.info(f"Routed to '{skillset}' (confidence: {confidence:.2f})")
        return {"skillset": skillset, "confidence": confidence}

    except Exception as e:
        logger.warning(f"Router classification failed: {e}")
        return {"skillset": "general", "confidence": 0.0}
