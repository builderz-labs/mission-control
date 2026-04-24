"""RoceOS LangGraph supervisor — routes queries to skillsets."""
import os

from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode, tools_condition

from config import settings
from skillsets import SKILLSET_REGISTRY
from core.llm import get_model
from tools.memory import MEMORY_TOOLS, WIKI_TOOLS, ALL_TOOLS
from tools.shell_and_web import SSH_TOOLS, HTTP_TOOLS, ACTION_TOOLS
from tools.services import GITHUB_TOOLS, TRADING_TOOLS
from tools.google import GOOGLE_CALENDAR_TOOLS, GOOGLE_GMAIL_TOOLS, GOOGLE_DRIVE_TOOLS, GOOGLE_TOOLS
from tools.obsidian import OBSIDIAN_TOOLS
from tools.unifi import UNIFI_TOOLS

# Checkpointer is set during lifespan init (async context manager)
_checkpointer = None

# Define which skillsets get which tools
SKILLSET_TOOLS = {
    "general": MEMORY_TOOLS + HTTP_TOOLS + GOOGLE_TOOLS + OBSIDIAN_TOOLS,
    "wealth": MEMORY_TOOLS + TRADING_TOOLS + GOOGLE_DRIVE_TOOLS + OBSIDIAN_TOOLS,
    "cto": MEMORY_TOOLS + SSH_TOOLS + HTTP_TOOLS + GITHUB_TOOLS + GOOGLE_DRIVE_TOOLS + OBSIDIAN_TOOLS,
    "ttrpg": ALL_TOOLS + GOOGLE_CALENDAR_TOOLS + GOOGLE_DRIVE_TOOLS + OBSIDIAN_TOOLS,
    "it_ops": MEMORY_TOOLS + SSH_TOOLS + HTTP_TOOLS + OBSIDIAN_TOOLS + UNIFI_TOOLS,
    "legal": MEMORY_TOOLS + HTTP_TOOLS + GOOGLE_DRIVE_TOOLS + GOOGLE_GMAIL_TOOLS + OBSIDIAN_TOOLS,
    "trading": MEMORY_TOOLS + HTTP_TOOLS + TRADING_TOOLS + OBSIDIAN_TOOLS,
    "security": MEMORY_TOOLS + SSH_TOOLS + HTTP_TOOLS + GOOGLE_GMAIL_TOOLS + OBSIDIAN_TOOLS + UNIFI_TOOLS,
    "household": MEMORY_TOOLS + HTTP_TOOLS + GOOGLE_CALENDAR_TOOLS + OBSIDIAN_TOOLS,
    "homelab": MEMORY_TOOLS + SSH_TOOLS + HTTP_TOOLS + GOOGLE_DRIVE_TOOLS + OBSIDIAN_TOOLS + UNIFI_TOOLS,
    "recreation": MEMORY_TOOLS + HTTP_TOOLS + GOOGLE_CALENDAR_TOOLS + OBSIDIAN_TOOLS,
}


# get_model is imported from core.llm — single source of truth for LLM access


def build_assistant_graph(skillset_id: str = "general"):
    """Build a LangGraph for a specific skillset with tools."""
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

    builder = StateGraph(MessagesState)
    builder.add_node("chat", chat_node)

    if tools:
        builder.add_node("tools", ToolNode(tools))
        builder.add_edge(START, "chat")
        builder.add_conditional_edges("chat", tools_condition)
        builder.add_edge("tools", "chat")
    else:
        builder.add_edge(START, "chat")
        builder.add_edge("chat", END)

    return builder


def set_checkpointer(cp):
    """Set the global checkpointer (called from lifespan)."""
    global _checkpointer
    _checkpointer = cp


def get_checkpointer():
    """Get the current checkpointer."""
    return _checkpointer
