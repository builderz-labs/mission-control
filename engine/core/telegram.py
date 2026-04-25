"""RoceOS Telegram Bot — bidirectional communication with Ross.

Handles:
- Incoming text messages from Telegram → routed through LangGraph
- Incoming photos → vision pre-process → routed as text with description
- Outbound notifications → sent to Ross's Telegram
- Only responds to Ross (user_id check)
"""
import asyncio
import base64
import logging
import os
import uuid

import httpx
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

from config import settings

logger = logging.getLogger("roceos.telegram")

# Global reference to the bot application
_app: Application | None = None
_message_handler_fn = None
_direct_handler_fn = None  # For direct skillset routing


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command."""
    if update.effective_user.id != settings.telegram_user_id:
        return
    await update.message.reply_text(
        "RoceOS online.\n\n"
        "Auto-routing is active — just send any message.\n\n"
        "Direct skillset commands:\n"
        "/wealth — finance, budget, spending\n"
        "/cto — code, repos, infrastructure\n"
        "/ttrpg — CY_BORG, session prep\n"
        "/general — general questions\n"
        "/status — show active skillsets"
    )


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /status command — show loaded skillsets."""
    if update.effective_user.id != settings.telegram_user_id:
        return

    from skillsets import SKILLSET_REGISTRY

    lines = ["RoceOS Skillsets:\n"]
    for sid, cfg in SKILLSET_REGISTRY.items():
        lines.append(f"- {cfg.name} (/{sid}) [{cfg.model_tier}]")

    await update.message.reply_text("\n".join(lines))


async def skillset_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /wealth, /cto, /ttrpg, /general commands.

    Usage: /wealth How much did I spend on food this month?
    If no message after command, prompts for one.
    """
    if update.effective_user.id != settings.telegram_user_id:
        return

    command = update.message.text.split()[0].lstrip("/").lower()
    # Extract the message after the command
    message = update.message.text[len(command) + 1:].strip()

    if not message:
        from skillsets import SKILLSET_REGISTRY
        cfg = SKILLSET_REGISTRY.get(command)
        name = cfg.name if cfg else command
        await update.message.reply_text(f"[{name}] Ready. Send your question.")
        # Store the skillset override for next message
        context.user_data["skillset_override"] = command
        return

    if not _direct_handler_fn:
        await update.message.reply_text("Engine not ready.")
        return

    await update.message.chat.send_action("typing")

    try:
        response = await _direct_handler_fn(message, command)
        if len(response) <= 4096:
            await update.message.reply_text(response)
        else:
            for i in range(0, len(response), 4096):
                await update.message.reply_text(response[i:i + 4096])
    except Exception as e:
        logger.error(f"Error in skillset command: {e}")
        await update.message.reply_text(f"Error: {str(e)[:200]}")


PHOTO_VISION_PROMPT = (
    "Describe this photo in 2-4 sentences for a downstream agent. Focus on the "
    "subject, distinctive visual features, and any text visible. If the subject "
    "looks like a houseplant, name the plant type if you can identify it "
    "(common name + botanical if known) and call out leaf shape, variegation, "
    "growth habit, and any visible health issues. If the subject is an aquarium "
    "fish, identify the species. If text is present, transcribe it. No fluff."
)


async def _analyze_photo_bytes(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """Call Anthropic Vision API on raw image bytes, return description.

    Auth strategy: try CLAUDE_CODE_OAUTH_TOKEN (Bearer) first because that's
    the $0 path via Ross's Max subscription. Fall back to ANTHROPIC_API_KEY
    if the OAT isn't accepted for /v1/messages with vision content (some
    OAT scopes differ from API key scopes).
    """
    img_b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    body = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 512,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": img_b64}},
                {"type": "text", "text": PHOTO_VISION_PROMPT},
            ],
        }],
    }

    # Build auth attempts in priority order
    attempts = []

    # 1. CLAUDE_CODE_OAUTH_TOKEN env var (if set explicitly)
    oat = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip()
    if oat:
        attempts.append(("OAT_env", {"Authorization": f"Bearer {oat}", "anthropic-version": "2023-06-01"}))

    # 2. OAT from /root/.claude/.credentials.json (bind-mounted, $0 path)
    try:
        import json as _json
        with open("/root/.claude/.credentials.json") as _f:
            _creds = _json.load(_f)
        _token = (_creds.get("claudeAiOauth") or _creds).get("accessToken", "").strip()
        if _token and _token.startswith("sk-ant-oat01-"):
            attempts.append(("OAT_creds", {"Authorization": f"Bearer {_token}", "anthropic-version": "2023-06-01"}))
    except Exception as _e:
        logger.debug(f"vision: could not read OAT from .credentials.json: {_e}")

    # 3. API key fallback from llm-config.json (paid path)
    try:
        from llm_failover import get_config
        cfg = get_config()
        api_key = (cfg.get("anthropic_api_key") or "").strip()
        if api_key:
            attempts.append(("API_KEY", {"x-api-key": api_key, "anthropic-version": "2023-06-01"}))
    except Exception:
        pass

    if not attempts:
        return "(vision unavailable: no OAT and no API key configured)"

    last_err = None
    async with httpx.AsyncClient(timeout=60) as client:
        for label, headers in attempts:
            headers["content-type"] = "application/json"
            try:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=body, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    blocks = data.get("content", [])
                    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
                    if text:
                        logger.info(f"vision OK via {label} ({len(text)} chars)")
                        return text
                    return "(vision returned empty)"
                last_err = f"{label} HTTP {resp.status_code}: {resp.text[:200]}"
                logger.warning(last_err)
            except Exception as e:
                last_err = f"{label} error: {e}"
                logger.warning(last_err)

    return f"(vision failed: {last_err})"


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receive a photo, run vision over it, route the description as text."""
    if not update.message or not update.message.photo:
        return
    if update.effective_user.id != settings.telegram_user_id:
        logger.warning(f"Ignoring photo from unauthorized user: {update.effective_user.id}")
        return

    await update.message.chat.send_action("typing")

    # Telegram sends multiple sizes — last one is the largest
    photo = update.message.photo[-1]
    caption = (update.message.caption or "").strip()

    try:
        tg_file = await context.bot.get_file(photo.file_id)
        # Download to memory
        image_bytes = await tg_file.download_as_bytearray()
    except Exception as e:
        logger.error(f"Failed to download photo: {e}")
        await update.message.reply_text(f"Couldn't download that photo: {e}")
        return

    description = await _analyze_photo_bytes(bytes(image_bytes), mime_type="image/jpeg")

    # Compose the routed message: caption (Ross's framing) + photo description
    if caption:
        routed = f"{caption}\n\n[Photo: {description}]"
    else:
        routed = f"[Photo received] {description}\n\nWhat would you like me to do with this?"

    if _message_handler_fn is None:
        await update.message.reply_text(routed)
        return

    try:
        response = await _message_handler_fn(routed)
        if len(response) <= 4096:
            await update.message.reply_text(response)
        else:
            for i in range(0, len(response), 4096):
                await update.message.reply_text(response[i:i + 4096])
    except Exception as e:
        logger.error(f"Error processing photo-derived message: {e}")
        await update.message.reply_text(f"Vision OK but routing errored: {str(e)[:200]}")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route incoming Telegram messages through the LangGraph pipeline."""
    if not update.message or not update.message.text:
        return

    # Only respond to Ross
    if update.effective_user.id != settings.telegram_user_id:
        logger.warning(
            f"Ignoring message from unauthorized user: {update.effective_user.id}"
        )
        return

    user_message = update.message.text
    logger.info(f"Telegram message from Ross: {user_message[:50]}...")

    # Check for skillset override from a previous /command with no message
    skillset_override = context.user_data.pop("skillset_override", None)

    if skillset_override and _direct_handler_fn:
        await update.message.chat.send_action("typing")
        try:
            response = await _direct_handler_fn(user_message, skillset_override)
            if len(response) <= 4096:
                await update.message.reply_text(response)
            else:
                for i in range(0, len(response), 4096):
                    await update.message.reply_text(response[i:i + 4096])
            return
        except Exception as e:
            logger.error(f"Error in override routing: {e}")
            await update.message.reply_text(f"Error: {str(e)[:200]}")
            return

    if _message_handler_fn is None:
        await update.message.reply_text("Engine not ready. Try again in a moment.")
        return

    # Send "typing" indicator
    await update.message.chat.send_action("typing")

    try:
        # Auto-route through PA Router → LangGraph
        response = await _message_handler_fn(user_message)

        # Telegram has a 4096 char limit per message
        if len(response) <= 4096:
            await update.message.reply_text(response)
        else:
            # Split long messages
            for i in range(0, len(response), 4096):
                await update.message.reply_text(response[i:i + 4096])

    except Exception as e:
        logger.error(f"Error processing Telegram message: {e}")
        await update.message.reply_text(f"Error: {str(e)[:200]}")


async def send_message(text: str, user_id: int | None = None):
    """Send a message to Ross via Telegram."""
    if _app is None or _app.bot is None:
        logger.warning("Telegram bot not initialized, cannot send message")
        return False

    target = user_id or settings.telegram_user_id
    try:
        await _app.bot.send_message(chat_id=target, text=text)
        return True
    except Exception as e:
        logger.error(f"Failed to send Telegram message: {e}")
        return False


async def start_bot(message_handler, direct_handler=None):
    """Start the Telegram bot with long polling.

    Args:
        message_handler: async function(message: str) -> str
            Called for auto-routed messages (PA classifies and routes).
        direct_handler: async function(message: str, skillset: str) -> str
            Called for direct /skillset commands (bypasses router).
    """
    global _app, _message_handler_fn, _direct_handler_fn

    if not settings.telegram_bot_token:
        logger.warning("No TELEGRAM_BOT_TOKEN set — Telegram disabled")
        return

    _message_handler_fn = message_handler
    _direct_handler_fn = direct_handler

    _app = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .build()
    )

    # Commands
    _app.add_handler(CommandHandler("start", start_command))
    _app.add_handler(CommandHandler("status", status_command))

    # Register all skillset commands dynamically
    from skillsets import SKILLSET_REGISTRY
    for sid in SKILLSET_REGISTRY:
        _app.add_handler(CommandHandler(sid, skillset_command))

    # Default message handler (auto-routing)
    _app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Photo handler — vision pre-process then route as text
    _app.add_handler(MessageHandler(filters.PHOTO, handle_photo))

    # Initialize and start polling in background
    await _app.initialize()
    await _app.start()
    await _app.updater.start_polling(drop_pending_updates=True)

    logger.info(f"Telegram bot started (polling) — {len(SKILLSET_REGISTRY)} skillsets active")

    # Send startup notification
    from skillsets import SKILLSET_REGISTRY
    skillset_list = ", ".join(SKILLSET_REGISTRY.keys())
    await send_message(
        f"RoceOS online. {len(SKILLSET_REGISTRY)} skillsets active: {skillset_list}\n"
        f"Auto-routing enabled. Use /status for details."
    )


async def stop_bot():
    """Stop the Telegram bot."""
    global _app
    if _app:
        try:
            await _app.updater.stop()
            await _app.stop()
            await _app.shutdown()
        except Exception as e:
            logger.debug(f"Telegram shutdown: {e}")
        _app = None
