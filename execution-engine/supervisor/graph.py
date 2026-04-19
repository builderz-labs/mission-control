"""RoceOS LangGraph supervisor — routes queries to skillsets."""
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.checkpoint.memory import InMemorySaver

from config import settings
from skillsets import SKILLSET_REGISTRY

# Phase 1: In-memory checkpointer (conversations persist during uptime)
# Phase 4: Upgrade to SQLite checkpointer for persistent memory
_checkpointer = InMemorySaver()


def get_model(tier: str) -> ChatOpenAI:
    """Get a model configured for the given tier via LiteLLM proxy.

    Uses ChatOpenAI because LiteLLM exposes an OpenAI-compatible API.
    The tier name (reasoning/analysis/fast) maps to Claude models in
    LiteLLM's config.
    """
    model_name = getattr(settings, f"model_{tier}", settings.model_analysis)
    return ChatOpenAI(
        model=model_name,
        base_url=f"{settings.litellm_base_url}/v1",
        api_key="not-needed",  # LiteLLM handles auth, no key required
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


def get_checkpointer():
    """Get the checkpointer for conversation persistence."""
    return _checkpointer
