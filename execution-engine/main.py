"""RoceOS Execution Engine — FastAPI server for LangGraph agent runtime."""
import json
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config import settings
from skillsets import SKILLSET_REGISTRY

# Import skillset modules to trigger registration
import skillsets.general  # noqa: F401
import skillsets.wealth  # noqa: F401
import skillsets.cto  # noqa: F401
import skillsets.ttrpg  # noqa: F401

from supervisor.graph import build_assistant_graph, get_checkpointer
from mc_bridge import bridge
import telegram_bot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("roceos")

# Global graph cache
_graphs = {}

# Per-skillset thread IDs for Telegram (maintains separate context per domain)
_telegram_threads = {
    "general": "tg-ross-general",
    "wealth": "tg-ross-wealth",
    "cto": "tg-ross-cto",
    "ttrpg": "tg-ross-ttrpg",
}


async def process_message(
    message: str,
    skillset: str = "general",
    thread_id: str | None = None,
) -> str:
    """Process a message through a specific skillset and return the response."""
    graph = _graphs.get(skillset)
    if not graph:
        # Fall back to general if skillset not found
        graph = _graphs.get("general")
        if not graph:
            return "Engine not ready."

    tid = thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": tid}}

    result = await graph.ainvoke(
        {"messages": [{"role": "user", "content": message}]},
        config=config,
    )

    return result["messages"][-1].content


async def handle_telegram_message(message: str) -> str:
    """Handle incoming Telegram message — auto-route via PA Router.

    Supports multi-skillset queries: if the router detects the question
    spans multiple domains, it fans out to each and synthesizes.
    """
    from supervisor.router import classify_intent
    from supervisor.cross_team import consult_multiple_skillsets

    # Auto-classify which skillset(s) should handle this
    routing = await classify_intent(message)
    skillsets = routing["skillsets"]

    # Multi-skillset query — fan out and synthesize
    if routing["multi"] and len(skillsets) > 1:
        return await consult_multiple_skillsets(message, skillsets, _graphs)

    # Single skillset — direct routing
    skillset = skillsets[0]
    thread_id = _telegram_threads.get(skillset, f"tg-ross-{skillset}")
    response = await process_message(message, skillset=skillset, thread_id=thread_id)

    # Add routing indicator
    prefix = ""
    if skillset != "general":
        name = SKILLSET_REGISTRY[skillset].name if skillset in SKILLSET_REGISTRY else skillset
        prefix = f"[{name}]\n"

    return f"{prefix}{response}"


async def handle_direct_skillset(message: str, skillset: str) -> str:
    """Handle a direct /skillset command — bypass PA router."""
    thread_id = _telegram_threads.get(skillset, f"tg-ross-{skillset}")
    response = await process_message(message, skillset=skillset, thread_id=thread_id)

    name = SKILLSET_REGISTRY[skillset].name if skillset in SKILLSET_REGISTRY else skillset
    return f"[{name}]\n{response}"


async def handle_mc_message(conversation_id: str, content: str, from_user: str):
    """Handle an incoming chat message from Mission Control."""
    from supervisor.router import classify_intent
    from supervisor.cross_team import consult_multiple_skillsets

    routing = await classify_intent(content)
    skillsets = routing["skillsets"]

    if routing["multi"] and len(skillsets) > 1:
        response = await consult_multiple_skillsets(content, skillsets, _graphs)
    else:
        response = await process_message(
            content, skillset=skillsets[0], thread_id=conversation_id,
        )

    await bridge.send_reply(
        conversation_id=conversation_id,
        content=response,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize graphs, checkpointer, and MC bridge on startup."""
    checkpointer = get_checkpointer()

    # Pre-build graphs for registered skillsets
    for skillset_id in SKILLSET_REGISTRY:
        builder = build_assistant_graph(skillset_id)
        _graphs[skillset_id] = builder.compile(checkpointer=checkpointer)

    logger.info(f"Loaded {len(_graphs)} skillset(s): {list(_graphs.keys())}")

    # Connect to Mission Control (non-blocking — MC may not be ready)
    connected = await bridge.connect("roceos-engine")
    if connected:
        await bridge.start_heartbeat()
        await bridge.start_event_listener(handle_mc_message)
        logger.info("Connected to Mission Control")
    else:
        logger.info("MC not available — running in standalone mode")

    # Start Telegram bot (auto-routing + direct skillset commands)
    await telegram_bot.start_bot(handle_telegram_message, handle_direct_skillset)

    yield

    # Cleanup
    await telegram_bot.stop_bot()
    await bridge.disconnect()


app = FastAPI(
    title="RoceOS Execution Engine",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow MC dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Phase 1: permissive. Tighten in Phase 7.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request/Response Models ──


class ChatRequest(BaseModel):
    message: str
    skillset: str = "general"
    thread_id: str | None = None


class ChatResponse(BaseModel):
    thread_id: str
    skillset: str
    content: str


class SkillsetInfo(BaseModel):
    id: str
    name: str
    description: str
    model_tier: str


class NotifyRequest(BaseModel):
    message: str
    user_id: int | None = None


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    telegram: bool = False
    skillsets: list[str] = Field(default_factory=list)


# ── API Routes ──


@app.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(
        skillsets=list(SKILLSET_REGISTRY.keys()),
        telegram=telegram_bot._app is not None,
    )


@app.get("/skillsets")
async def list_skillsets() -> list[SkillsetInfo]:
    return [
        SkillsetInfo(
            id=s.id,
            name=s.name,
            description=s.description,
            model_tier=s.model_tier,
        )
        for s in SKILLSET_REGISTRY.values()
    ]


@app.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    """Non-streaming chat endpoint."""
    graph = _graphs.get(request.skillset)
    if not graph:
        raise HTTPException(404, f"Skillset '{request.skillset}' not found")

    thread_id = request.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    result = await graph.ainvoke(
        {"messages": [{"role": "user", "content": request.message}]},
        config=config,
    )

    last_message = result["messages"][-1]
    return ChatResponse(
        thread_id=thread_id,
        skillset=request.skillset,
        content=last_message.content,
    )


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """SSE streaming chat endpoint — token-by-token responses."""
    graph = _graphs.get(request.skillset)
    if not graph:
        raise HTTPException(404, f"Skillset '{request.skillset}' not found")

    thread_id = request.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    async def event_generator():
        # Send thread_id first
        yield f"data: {json.dumps({'type': 'metadata', 'thread_id': thread_id, 'skillset': request.skillset})}\n\n"

        # Stream tokens
        async for event in graph.astream_events(
            {"messages": [{"role": "user", "content": request.message}]},
            config=config,
            version="v2",
        ):
            kind = event.get("event")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk.content})}\n\n"

            elif kind == "on_chat_model_end":
                yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/threads/{thread_id}/history")
async def get_thread_history(thread_id: str, skillset: str = "general"):
    """Get conversation history for a thread."""
    graph = _graphs.get(skillset)
    if not graph:
        raise HTTPException(404, f"Skillset '{skillset}' not found")

    config = {"configurable": {"thread_id": thread_id}}
    state = await graph.aget_state(config)

    if not state or not state.values:
        raise HTTPException(404, f"Thread '{thread_id}' not found")

    messages = []
    for msg in state.values.get("messages", []):
        messages.append({
            "role": getattr(msg, "type", "unknown"),
            "content": msg.content if hasattr(msg, "content") else str(msg),
        })

    return {"thread_id": thread_id, "messages": messages}


@app.post("/notify")
async def notify(request: NotifyRequest):
    """Send a notification message to Ross via Telegram."""
    sent = await telegram_bot.send_message(request.message, request.user_id)
    if not sent:
        raise HTTPException(503, "Telegram bot not available")
    return {"status": "sent"}
