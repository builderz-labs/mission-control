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

from supervisor.graph import build_assistant_graph, get_checkpointer
from mc_bridge import bridge

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("roceos")

# Global graph cache
_graphs = {}


async def handle_mc_message(conversation_id: str, content: str, from_user: str):
    """Handle an incoming chat message from Mission Control."""
    graph = _graphs.get("general")
    if not graph:
        return

    thread_id = conversation_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    result = await graph.ainvoke(
        {"messages": [{"role": "user", "content": content}]},
        config=config,
    )

    last_message = result["messages"][-1]
    await bridge.send_reply(
        conversation_id=conversation_id,
        content=last_message.content,
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

    yield

    # Cleanup
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


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    skillsets: list[str] = Field(default_factory=list)


# ── API Routes ──


@app.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(
        skillsets=list(SKILLSET_REGISTRY.keys()),
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
