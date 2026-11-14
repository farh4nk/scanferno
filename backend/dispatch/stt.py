"""Speech to text for recorded dispatch calls -> transcript lines [{"t", "speaker", "text"}].

Uses Deepgram (DEEPGRAM_API_KEY) or ElevenLabs Scribe (ELEVENLABS_API_KEY), whichever is set. Both
diarize, so we get a speaker per line; the first speaker is assumed to be the dispatcher (scripted calls
open with "911, what's the address of your emergency?").
"""
import os

import httpx


def available() -> str | None:
    if os.getenv("DEEPGRAM_API_KEY"):
        return "deepgram"
    if os.getenv("ELEVENLABS_API_KEY"):
        return "elevenlabs"
    return None


def _label(speakers: list) -> dict:
    first = speakers[0] if speakers else None
    return {s: ("dispatcher" if s == first else "caller") for s in speakers}


def deepgram(audio: bytes, mime: str = "audio/wav") -> list[dict]:
    r = httpx.post(
        "https://api.deepgram.com/v1/listen",
        params={"model": "nova-3", "smart_format": "true", "diarize": "true", "utterances": "true", "punctuate": "true"},
        headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}", "Content-Type": mime},
        content=audio, timeout=120,
    )
    r.raise_for_status()
    utts = r.json().get("results", {}).get("utterances") or []
    names = _label(list(dict.fromkeys(u.get("speaker", 0) for u in utts)))
    return [{"t": round(u["start"], 1), "speaker": names[u.get("speaker", 0)], "text": u["transcript"]} for u in utts]


def elevenlabs(audio: bytes, mime: str = "audio/wav") -> list[dict]:
    r = httpx.post(
        "https://api.elevenlabs.io/v1/speech-to-text",
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        data={"model_id": "scribe_v1", "diarize": "true"},
        files={"file": ("call", audio, mime)},
        timeout=120,
    )
    r.raise_for_status()
    words = [w for w in r.json().get("words") or [] if w.get("type") != "spacing"]
    lines, cur = [], None
    for w in words:
        spk = w.get("speaker_id", "speaker_0")
        if cur is None or cur["_spk"] != spk:
            cur = {"t": round(w.get("start", 0), 1), "_spk": spk, "text": w["text"]}
            lines.append(cur)
        else:
            cur["text"] += " " + w["text"]
    names = _label(list(dict.fromkeys(l["_spk"] for l in lines)))
    return [{"t": l["t"], "speaker": names[l["_spk"]], "text": l["text"].strip()} for l in lines]


def transcribe(audio: bytes, mime: str = "audio/wav") -> list[dict]:
    provider = available()
    if provider == "deepgram":
        return deepgram(audio, mime)
    if provider == "elevenlabs":
        return elevenlabs(audio, mime)
    raise RuntimeError("No speech-to-text key set (DEEPGRAM_API_KEY or ELEVENLABS_API_KEY). Use the typed transcript fallback.")
