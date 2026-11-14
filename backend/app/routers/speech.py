"""Spoken output (briefing narration, mayday steps) in ElevenLabs voices instead of the browser's robotic one.

Every line is cached under fixtures/tts/<hash>.mp3 (+ .json word timings), so a rehearsed demo plays
offline and repeats cost nothing.
"""
import hashlib

from fastapi import APIRouter, Body, HTTPException

from data import cache
from dispatch import elevenlabs

router = APIRouter(tags=["speech"])
VOICES = {"narrator", "firefighter", "dispatcher", "caller", "caller2"}


@router.post("/speech")
def speech(text: str = Body(..., embed=True), voice: str = Body("narrator", embed=True)):
    """{text, voice} -> {audio_url, words: [{word, start, end}], cached}. Voices are the call roles."""
    text = " ".join(text.split())
    if not text:
        raise HTTPException(400, "empty text")
    if voice not in VOICES:
        raise HTTPException(400, f"voice must be one of {sorted(VOICES)}")
    key = hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()[:16]
    meta = cache.load_json("tts", f"{key}.json")
    if meta:
        return {**meta, "cached": True}
    if not elevenlabs.available():
        raise HTTPException(503, "ELEVENLABS_API_KEY is not set")
    try:
        audio, words = elevenlabs.tts_timed(text, voice)
    except Exception as e:  # noqa: BLE001 - surface ElevenLabs errors to the client
        raise HTTPException(502, f"ElevenLabs: {e}") from e
    cache.save_bytes(audio, "tts", f"{key}.mp3")
    meta = {"text": text, "voice": voice, "audio_url": f"/fixtures/tts/{key}.mp3", "words": words}
    cache.save_json(meta, "tts", f"{key}.json")
    return {**meta, "cached": False}
