"""RoceOS LangGraph supervisor — routes queries to skillsets."""
import os
import sqlite3

from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.prebuilt import ToolNode, tools_condition

from config import settings
from skillsets import SKILLSET_REGISTRY
from memory.tools import MEMORY_TOOLS, WIKI_TOOLS, ALL_TOOLS

# Persistent SQLite checkpointer — conversations survive restarts
_db_path = os.path.join(settings.data_dir, "checkpoints.db")
os.makedirs(os.path.dirname(_db_path), exist_ok=True)
_conn = sqlite3.connect(_db_path, check_same_thread=False)
_checkpointer = SqliteSaver(_conn)

# Define which skillsets get which tools
SKILLSET_TOOLS = {
    "general": MEMORY_TOOLS,
    "wealth": MEMORY_TOOLS,
    "cto": MEMORY_TOOLS,
    "ttrpg": ALL_TOOLS,  # TTRPG gets wiki access + memory
}


def get_model(tier: str) -> ChatOpenAI:
    """Get a model configured for the given tier via LiteLLM proxy."""
    model_name = getattr(settings, f"model_{tier}", settings.model_analysis)
    return ChatOpenAI(
        model=model_name,
        base_url=f"{settings.litellm_base_url}/v1",
        api_key="not-needed",
        streaming=True,
    )


def build_assistant_graph(skillset_id: str = "general"):
    """Build a LangGraph for a specific skillset with tools.

    Each skillset gets:
    - Its own model tier (fast/analysis/reasoning)
    - Memory tools (remember/recall facts)
    - Domain-specific tools (wiki access for TTRPG, etc.)
    - Tool-use loop (model calls tools, gets results, responds)
    """
    config = SKILLSET_REGISTRY.get(skillset_id)
    if not config:
        raise ValueError(f"Unknown skillset: {skillset_id}")

    tools = SKILLSET_TOOLS.get(skillset_id, MEMORY_TOOLS)
    model = get_model(config.model_tier)

    if tools:
        model_with_tools = model.bind_tools(tools)
    else:
        model_with_tools = model

    async def chat_node(state: MessagesState):
        """Process a message through the skillset's model."""
        system_message = {"role": "system", "content": config.system_prompt}
        messages = [system_message] + state["messages"]
        response = await model_with_tools.ainvoke(messages)
        return {"messages": [response]}

    # Build the graph
    builder = StateGraph(MessagesState)
    builder.add_node("chat", chat_node)

    if tools:
        # Add tool execution node and conditional routing
        builder.add_node("tools", ToolNode(tools))
        builder.add_edge(START, "chat")
        builder.add_conditional_edges("chat", tools_condition)
        builder.add_edge("tools", "chat")
    else:
        builder.add_edge(START, "chat")
        builder.add_edge("chat", END)

    return builder


def get_checkpointer():
    """Get the SQLite checkpointer for persistent conversation memory."""
    return _checkpointer
