"""TTS module for JARVIS — Fish Audio (paid) and Edge TTS (free) synthesis."""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

log = logging.getLogger("jarvis")

# TTS configuration — live here since they are TTS-specific concerns
TTS_ENGINE = os.getenv("TTS_ENGINE", "fish")
FISH_API_KEY = os.getenv("FISH_API_KEY", "")
FISH_VOICE_ID = os.getenv("FISH_VOICE_ID", "612b878b113047d9a770c069c8b4fdfe")  # JARVIS (MCU)
FISH_API_URL = "https://api.fish.audio/v1/tts"


async def synthesize_speech(text: str) -> Optional[bytes]:
    """Generate speech audio from text. Uses Fish Audio (paid) or Edge TTS (free) based on TTS_ENGINE.
    Falls back to Edge TTS automatically when Fish Audio fails (e.g. 402 payment, network error).
    """
    # WHY: import deferred to avoid circular dependency — jarvis_usage imports nothing from here
    from jarvis_usage import _session_tokens, _append_usage_entry  # noqa: PLC0415

    if TTS_ENGINE == "edge" or not FISH_API_KEY:
        return await _synthesize_edge(text, _session_tokens, _append_usage_entry)
    # WHY: Fish Audio is the preferred voice but can fail (expired credits, network).
    # Edge TTS is free and always available — never leave Jarvis mute.
    result = await _synthesize_fish(text, _session_tokens, _append_usage_entry)
    if result is None:
        log.warning("Fish Audio unavailable — falling back to Edge TTS")
        return await _synthesize_edge(text, _session_tokens, _append_usage_entry)
    return result


async def _synthesize_fish(text: str, session_tokens: dict, append_usage_entry) -> Optional[bytes]:
    """Fish Audio TTS — high quality JARVIS voice (paid)."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            response = await http.post(
                FISH_API_URL,
                headers={
                    "Authorization": f"Bearer {FISH_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "reference_id": FISH_VOICE_ID,
                    "format": "mp3",
                },
            )
            if response.status_code == 200:
                session_tokens["tts_calls"] += 1
                append_usage_entry(0, 0, "tts")
                return response.content
            else:
                log.error(f"TTS error: {response.status_code}")
                return None
    except Exception as e:
        log.error(f"TTS error: {e}")
        return None


async def _synthesize_edge(text: str, session_tokens: dict, append_usage_entry) -> Optional[bytes]:
    """Microsoft Edge TTS — free, no API key, British male voice."""
    try:
        import io
        import edge_tts
        # en-GB-RyanNeural: British male, closest free voice to JARVIS
        communicate = edge_tts.Communicate(text, voice="en-GB-RyanNeural", rate="+5%", pitch="-5Hz")
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        audio = buf.getvalue()
        if audio:
            session_tokens["tts_calls"] += 1
            append_usage_entry(0, 0, "tts")
            return audio
        return None
    except Exception as e:
        log.error(f"Edge TTS error: {e}")
        return None
