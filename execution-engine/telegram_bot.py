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


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command."""
    if update.effective_user.id != settings.telegram_user_id:
        return
    await update.message.reply_text(
        "RoceOS online. General Assistant ready.\n"
        "Send any message to chat."
    )


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

    if _message_handler_fn is None:
        await update.message.reply_text("Engine not ready. Try again in a moment.")
        return

    # Send "typing" indicator
    await update.message.chat.send_action("typing")

    try:
        # Route through LangGraph
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


async def start_bot(message_handler):
    """Start the Telegram bot with long polling.

    Args:
        message_handler: async function(message: str) -> str
            Called for each incoming message, returns response text.
    """
    global _app, _message_handler_fn

    if not settings.telegram_bot_token:
        logger.warning("No TELEGRAM_BOT_TOKEN set — Telegram disabled")
        return

    _message_handler_fn = message_handler

    _app = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .build()
    )

    _app.add_handler(CommandHandler("start", start_command))
    _app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Initialize and start polling in background
    await _app.initialize()
    await _app.start()
    await _app.updater.start_polling(drop_pending_updates=True)

    logger.info("Telegram bot started (polling)")

    # Send startup notification
    await send_message("RoceOS execution engine online. General Assistant ready.")


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
