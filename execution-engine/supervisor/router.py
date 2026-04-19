"""PA Router — classifies user intent and routes to the correct skillset.

Uses the 'fast' model tier (Haiku) for cheap, fast classification.
Returns the skillset ID that should handle the query.
"""
import json
import logging

from langchain_openai import ChatOpenAI
from config import settings

logger = logging.getLogger("roceos.router")

ROUTING_PROMPT = """You are a routing classifier for RoceOS, Ross Hickey's personal AI operating system.

Given a user message, determine which skillset should handle it. Respond with ONLY a JSON object:
{"skillset": "<id>", "confidence": <0.0-1.0>}

Available skillsets:

- "general" — Default. General conversation, questions that don't fit elsewhere, greetings, meta-questions about RoceOS itself.

- "wealth" — Personal finance, budgeting, bills, bank accounts, Monarch, Era Context, debt payoff, savings, investments, spending analysis, income, bill splitting with Cat. Keywords: money, budget, spend, account, balance, bills, debt, savings, Monarch, financial.

- "cto" — Software development, coding, GitHub repos, deployments, CI/CD, code review, architecture, building features, debugging, DevOps, Docker, infrastructure as code. Keywords: code, build, deploy, repo, PR, bug, feature, refactor, test.

- "ttrpg" — Tabletop RPG, CY_BORG campaign "Lucky Flight Takedown", session prep, NPCs, rules lookup, dice, combat mechanics, GM prep. Keywords: CY_BORG, session, campaign, NPC, dice, combat, RPG, tabletop, Lucky Flight.

Rules:
- If the message clearly belongs to one domain, route there with high confidence.
- If ambiguous or could be multiple, route to "general" with lower confidence.
- Greetings, meta-questions, and "what can you do" always go to "general".
- Questions about Ross's network, devices, VPS, homelab go to "general" for now (IT Ops not built yet).
- Questions about trading, stocks, crypto go to "general" for now (Trading not built yet).
- Questions about legal matters go to "general" for now (Legal not built yet).
"""


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
    )

    try:
        response = await model.ainvoke([
            {"role": "system", "content": ROUTING_PROMPT},
            {"role": "user", "content": message},
        ])

        result = json.loads(response.content.strip())
        skillset = result.get("skillset", "general")
        confidence = result.get("confidence", 0.5)

        logger.info(f"Routed to '{skillset}' (confidence: {confidence:.2f})")
        return {"skillset": skillset, "confidence": confidence}

    except (json.JSONDecodeError, Exception) as e:
        logger.warning(f"Router classification failed: {e}")
        return {"skillset": "general", "confidence": 0.0}
