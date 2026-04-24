"""Cross-team consultation — synthesize responses from multiple skillsets.

When a query spans multiple domains, the PA fans out to each skillset,
collects their perspectives, then synthesizes a unified response.
"""
import asyncio
import logging
import uuid

from config import settings
from core.llm import get_model

logger = logging.getLogger("roceos.cross_team")

SYNTHESIS_PROMPT = """You are the RoceOS Personal Assistant synthesizer. You've consulted multiple specialist teams about Ross's question.

Your job: combine their perspectives into ONE clear, actionable response.

Rules:
- Lead with the direct answer or recommendation
- If teams agree, present the unified view
- If teams disagree or have different concerns, present both perspectives clearly: "CTO recommends X. Wealth flags Y concern."
- End with a clear recommendation or next step
- Be concise — no filler, no repeating what each team said verbatim
- Use plain text (Telegram formatting)
- Don't say "the teams said" — just present the synthesized answer as your own"""


async def consult_multiple_skillsets(
    message: str,
    skillset_ids: list[str],
    graphs: dict,
) -> str:
    """Fan out a query to multiple skillsets and synthesize their responses.

    Args:
        message: The user's original message
        skillset_ids: List of skillset IDs to consult
        graphs: Dict of compiled LangGraph graphs

    Returns:
        Synthesized response string
    """
    from skillsets import SKILLSET_REGISTRY

    # Fan out — query each skillset concurrently
    async def query_skillset(sid: str) -> tuple[str, str]:
        graph = graphs.get(sid)
        if not graph:
            return sid, f"[{sid} unavailable]"

        thread_id = f"cross-team-{uuid.uuid4().hex[:8]}"
        config = {"configurable": {"thread_id": thread_id}}

        try:
            result = await graph.ainvoke(
                {"messages": [{"role": "user", "content": message}]},
                config=config,
            )
            return sid, result["messages"][-1].content
        except Exception as e:
            logger.error(f"Error consulting {sid}: {e}")
            return sid, f"[Error from {sid}: {str(e)[:100]}]"

    # Run all consultations concurrently
    tasks = [query_skillset(sid) for sid in skillset_ids]
    results = await asyncio.gather(*tasks)

    # Build consultation summary for the synthesizer
    consultation_parts = []
    for sid, response in results:
        name = SKILLSET_REGISTRY[sid].name if sid in SKILLSET_REGISTRY else sid
        consultation_parts.append(f"=== {name} ===\n{response}")

    consultation_text = "\n\n".join(consultation_parts)

    # Synthesize with the analysis model
    synthesizer = get_model("analysis")

    synthesis = await synthesizer.ainvoke([
        {"role": "system", "content": SYNTHESIS_PROMPT},
        {"role": "user", "content": (
            f"Ross asked: \"{message}\"\n\n"
            f"Here are the team responses:\n\n{consultation_text}"
        )},
    ])

    # Build the final response with team indicators
    team_names = []
    for sid in skillset_ids:
        name = SKILLSET_REGISTRY[sid].name if sid in SKILLSET_REGISTRY else sid
        team_names.append(name)

    header = f"[{' + '.join(team_names)}]"
    return f"{header}\n{synthesis.content}"
