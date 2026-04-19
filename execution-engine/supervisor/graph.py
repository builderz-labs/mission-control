"""RoceOS LangGraph supervisor — routes queries to skillsets."""
import os
from langchain_anthropic import ChatAnthropic
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from config import settings
from skillsets import SKILLSET_REGISTRY


def get_model(tier: str) -> ChatAnthropic:
    """Get a ChatAnthropic model configured for the given tier."""
    model_name = getattr(settings, f"model_{tier}", settings.model_analysis)
    return ChatAnthropic(
        model=model_name,
        base_url=f"{settings.litellm_base_url}/v1",
        api_key="not-needed",  # LiteLLM handles auth
        streaming=True,
    )


def build_assistant_graph(skillset_id: str = "general"):
    """Build a LangGraph for a specific skillset.

    Phase 1: Simple single-skillset graph (no routing yet).
    Phase 2+: PA supervisor with multi-skillset routing.
    """
    config = SKILLSET_REGISTRY.get(skillset_id)
    if not config:
        raise ValueError(f"Unknown skillset: {skillset_id}")

    model = get_model(config.model_tier)

    async def chat_node(state: MessagesState):
        """Process a message through the skillset's model."""
        system_message = {"role": "system", "content": config.system_prompt}
        messages = [system_message] + state["messages"]
        response = await model.ainvoke(messages)
        return {"messages": [response]}

    # Build the graph
    builder = StateGraph(MessagesState)
    builder.add_node("chat", chat_node)
    builder.add_edge(START, "chat")
    builder.add_edge("chat", END)

    return builder


async def get_checkpointer():
    """Get the SQLite checkpointer for conversation persistence."""
    db_path = os.path.join(settings.data_dir, "checkpoints.db")
    return AsyncSqliteSaver.from_conn_string(db_path)


async def create_graph(skillset_id: str = "general"):
    """Create a compiled graph with checkpointing."""
    builder = build_assistant_graph(skillset_id)
    checkpointer = await get_checkpointer()
    return builder.compile(checkpointer=checkpointer)
