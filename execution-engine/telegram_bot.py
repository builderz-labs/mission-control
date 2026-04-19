"""RoceOS Telegram Bot — bidirectional communication with Ross.

Handles:
- Incoming messages from Telegram → routed through LangGraph
- Outbound notifications → sent to Ross's Telegram
- Only responds to Ross (user_id check)
"""
import asyncio
import logging
import uuid

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
    _app.add_handler(CommandHandler("wealth", skillset_command))
    _app.add_handler(CommandHandler("cto", skillset_command))
    _app.add_handler(CommandHandler("ttrpg", skillset_command))
    _app.add_handler(CommandHandler("general", skillset_command))

    # Default message handler (auto-routing)
    _app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Initialize and start polling in background
    await _app.initialize()
    await _app.start()
    await _app.updater.start_polling(drop_pending_updates=True)

    logger.info("Telegram bot started (polling) — 4 skillsets active")

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
