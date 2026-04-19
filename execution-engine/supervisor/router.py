"""PA Router — classifies user intent and routes to the correct skillset(s).

Uses the 'fast' model tier (Haiku) for cheap, fast classification.
Supports multi-skillset routing for cross-domain queries.
"""
import json
import logging
import re

from langchain_openai import ChatOpenAI
from config import settings

logger = logging.getLogger("roceos.router")

ROUTING_PROMPT = """You are a message router. Output ONLY raw JSON, no markdown, no code fences, no explanation.

Classify which team(s) handle this message.

If the message involves ONE domain, output:
{"skillsets":["<id>"],"confidence":0.9}

If the message spans MULTIPLE domains, list all relevant teams:
{"skillsets":["<id1>","<id2>"],"confidence":0.8}

Teams:
- "wealth" — money, budget, spending, bills, debt, savings, income, accounts, Monarch, financial planning, discretionary budget, net worth, 401k, investments, affordability
- "cto" — code, software, GitHub, repos, deploy, Docker, build, architecture, DevOps, programming, infrastructure projects
- "ttrpg" — CY_BORG, tabletop RPG, campaign, NPCs, combat, dice, session prep, Wattana, Zola, Lucky Flight
- "general" — everything else: greetings, weather, general questions, topics without a dedicated team

Multi-team examples:
- "Can I afford to buy homelab gear?" → ["wealth"] (affordability is purely financial)
- "Should I invest $600 in a homelab server or pay down debt?" → ["wealth","cto"] (financial tradeoff + tech recommendation)
- "Plan my weekend with disc golf and budget for it" → ["wealth","general"] (spending + scheduling)

IMPORTANT: Only use multiple teams when the question genuinely requires expertise from both. Most questions are single-team."""

VALID_SKILLSETS = {"general", "wealth", "cto", "ttrpg"}


def _extract_json(text: str) -> dict:
    """Extract JSON from a response that might have code fences or extra text."""
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
    match = re.search(r'\{[^{}]*"skillset[^{}]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return {}


async def classify_intent(message: str) -> dict:
    """Classify a message and return the target skillset(s).

    Returns:
        {"skillsets": list[str], "confidence": float, "multi": bool}
    """
    model = ChatOpenAI(
        model=settings.model_fast,
        base_url=f"{settings.litellm_base_url}/v1",
        api_key="not-needed",
        temperature=0,
        max_tokens=40,
    )

    try:
        response = await model.ainvoke([
            {"role": "system", "content": ROUTING_PROMPT},
            {"role": "user", "content": message},
        ])

        result = _extract_json(response.content)

        # Support both old format {"skillset": "x"} and new {"skillsets": ["x"]}
        if "skillsets" in result:
            skillsets = result["skillsets"]
        elif "skillset" in result:
            skillsets = [result["skillset"]]
        else:
            skillsets = ["general"]

        confidence = result.get("confidence", 0.5)

        # Validate and filter
        skillsets = [s for s in skillsets if s in VALID_SKILLSETS]
        if not skillsets:
            skillsets = ["general"]

        multi = len(skillsets) > 1
        logger.info(
            f"Routed to {skillsets} (confidence: {confidence:.2f}, multi: {multi})"
        )
        return {"skillsets": skillsets, "confidence": confidence, "multi": multi}

    except Exception as e:
        logger.warning(f"Router classification failed: {e}")
        return {"skillsets": ["general"], "confidence": 0.0, "multi": False}
