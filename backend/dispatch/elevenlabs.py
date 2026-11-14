"""ElevenLabs speech-to-text (dispatch calls) and text-to-speech (scripted calls, mayday directions).

Key needs Speech to Text and Text to Speech. Voices per role come from
ELEVENLABS_VOICE_<ROLE> in .env (copy ids from the ElevenLabs voice library), or, if the
key also has Voices: Read, are picked automatically from your account's voices.
"""
import os

import httpx

BASE = "https://api.elevenlabs.io/v1"
STT_MODELS = ["scribe_v2", "scribe_v1"]
TTS_MODELS = ["eleven_v3", "eleven_multilingual_v2"]  # v3 understands [panicked]-style tags
# Preferred voice names per role when auto-picking from the account.
ROLES = {
    "dispatcher": ["Daniel", "Eric", "George", "Brian"],
    "caller": ["Sarah", "Jessica", "Laura", "Lily"],
    "caller2": ["Adam", "Charlie", "Liam", "Will"],
    "firefighter": ["Harry", "Callum", "Roger", "Bill"],  # mayday radio calls
    "narrator": ["Alice", "Matilda", "River", "Bella"],   # spoken mayday directions
}
SAMPLE_RATE = 16000  # pcm_16000 output: 16-bit mono
_voices: dict[str, str] = {}


def voice_id(role: str) -> str:
    env = os.getenv(f"ELEVENLABS_VOICE_{role.upper()}")
    if env:
        return env
    if not _voices:
        r = httpx.get(f"{BASE}/voices", headers=_headers(), timeout=30)
        if r.status_code == 401:
            raise RuntimeError(
                f"No voice for '{role}': set ELEVENLABS_VOICE_{role.upper()} in .env, "
                "or give the ElevenLabs key 'Voices: Read'."
            )
        r.raise_for_status()
        voices = r.json()["voices"]
        by_name = {v["name"].split()[0].split("-")[0]: v["voice_id"] for v in voices}
        for rl, prefs in ROLES.items():
            _voices[rl] = next((by_name[p] for p in prefs if p in by_name), voices[0]["voice_id"])
    return _voices[role]

tts_model: str | None = None
stt_model: str | None = None


class NotConfigured(RuntimeError):
    pass


def available() -> bool:
    return bool(os.getenv("ELEVENLABS_API_KEY"))


def _headers() -> dict:
    if not available():
        raise NotConfigured("ELEVENLABS_API_KEY is not set: server transcription is off (use browser speech or typed lines)")
    return {"xi-api-key": os.environ["ELEVENLABS_API_KEY"]}


def _model_rejected(r: httpx.Response) -> bool:
    return r.status_code in (400, 404, 422) and "model" in r.text.lower()


def tts(text: str, voice: str = "narrator", emotion: str | None = None) -> bytes:
    """Raw 16 kHz 16-bit mono PCM. `emotion` becomes a v3 audio tag, dropped on older models."""
    global tts_model
    vid = voice_id(voice) if voice in ROLES else voice
    last = None
    for m in [tts_model] if tts_model else TTS_MODELS:
        body = f"[{emotion}] {text}" if emotion and m == "eleven_v3" else text
        r = httpx.post(
            f"{BASE}/text-to-speech/{vid}",
            params={"output_format": f"pcm_{SAMPLE_RATE}"},
            json={"text": body, "model_id": m},
            headers=_headers(),
            timeout=60,
        )
        if _model_rejected(r):
            last = r
            continue
        r.raise_for_status()
        tts_model = m
        return r.content
    raise RuntimeError(f"ElevenLabs TTS rejected all models: {last.status_code} {last.text[:300]}")


def tts_timed(text: str, voice: str = "narrator") -> tuple[bytes, list[dict]]:
    """MP3 plus word timings [{word, start, end}] from the with-timestamps endpoint, so a caption can follow
    the voice word by word. Tries the expressive model first, then the multilingual one."""
    import base64
    vid = voice_id(voice) if voice in ROLES else voice
    last = None
    for m in TTS_MODELS:
        r = httpx.post(
            f"{BASE}/text-to-speech/{vid}/with-timestamps",
            params={"output_format": "mp3_44100_128"},
            json={"text": text, "model_id": m},
            headers=_headers(),
            timeout=90,
        )
        if _model_rejected(r):
            last = r
            continue
        r.raise_for_status()
        j = r.json()
        al = j.get("normalized_alignment") or j.get("alignment") or {}
        chars, starts, ends = al.get("characters", []), al.get("character_start_times_seconds", []), al.get("character_end_times_seconds", [])
        words, cur = [], None
        for ch, a, b in zip(chars, starts, ends):
            if ch.isspace():
                if cur:
                    words.append(cur)
                cur = None
            elif cur is None:
                cur = {"word": ch, "start": a, "end": b}
            else:
                cur["word"] += ch
                cur["end"] = b
        if cur:
            words.append(cur)
        return base64.b64decode(j["audio_base64"]), words
    raise RuntimeError(f"ElevenLabs TTS rejected all models: {last.status_code} {last.text[:300]}")


def stt(audio: bytes, filename: str = "call.wav") -> dict:
    """Transcript with word timings and speaker ids: {text, words: [{text, start, end, type, speaker_id}]}."""
    global stt_model
    last = None
    for m in [stt_model] if stt_model else STT_MODELS:
        r = httpx.post(
            f"{BASE}/speech-to-text",
            files={"file": (filename, audio)},
            data={"model_id": m, "diarize": "true", "timestamps_granularity": "word", "tag_audio_events": "false"},
            headers=_headers(),
            timeout=180,
        )
        if _model_rejected(r):
            last = r
            continue
        r.raise_for_status()
        stt_model = m
        return r.json()
    raise RuntimeError(f"ElevenLabs STT rejected all models: {last.status_code} {last.text[:300]}")
