"""Call pipeline: script -> audio -> transcript -> utterances -> live timeline of dispatch records.

Each call lives in fixtures/calls/<call_id>/:
  script.json      what's said (hand-written; source of truth for synthesized calls)
  audio.wav        16 kHz mono call audio (synthesized, or a real recording of teammates)
  transcript.json  raw ElevenLabs STT result (cached)
  timeline.json    [{t, utterance_index, record}] (cached; drives the demo replay offline)
"""
import io
import subprocess
import tempfile
import wave
from pathlib import Path

from data import cache

from . import elevenlabs, extract

CALLS = cache.FIXTURES / "calls"
SAY_VOICES = {"dispatcher": "Samantha", "caller": "Daniel", "caller2": "Karen", "narrator": "Samantha"}


def call_dir(call_id: str) -> Path:
    return CALLS / call_id


def audio_file(call_id: str) -> Path | None:
    """audio.wav for synthesized calls; saved live calls keep the browser's format (audio.webm, ...)."""
    d = call_dir(call_id)
    return d / "audio.wav" if (d / "audio.wav").exists() else next(iter(sorted(d.glob("audio.*"))), None)


def audio_url(call_id: str) -> str | None:
    f = audio_file(call_id)
    return f"/fixtures/calls/{call_id}/{f.name}" if f else None


def list_calls() -> list[dict]:
    out = []
    for d in sorted(CALLS.glob("*/script.json")):
        cid = d.parent.name
        s = cache.load_json("calls", cid, "script.json")
        out.append({
            "call_id": cid,
            "building_id": s["building_id"],
            "title": s.get("title"),
            "kind": s.get("kind"),
            "has_audio": audio_file(cid) is not None,
            "audio_url": audio_url(cid),
            "has_timeline": (d.parent / "timeline.json").exists(),
        })
    return out


# ---- synthesis ----

def _say_pcm(text: str, voice: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "line.wav"
        subprocess.run(["say", "-v", voice, "-o", str(path), "--file-format=WAVE",
                        f"--data-format=LEI16@{elevenlabs.SAMPLE_RATE}", text], check=True)
        with wave.open(str(path)) as w:
            return w.readframes(w.getnframes())


def synthesize(call_id: str, engine: str = "elevenlabs") -> Path:
    """Render script.json to audio.wav. engine: elevenlabs | say (macOS, offline)."""
    script = cache.load_json("calls", call_id, "script.json")
    frames = bytearray()
    for line in script["lines"]:
        role = line["role"]
        if engine == "elevenlabs":
            pcm = elevenlabs.tts(line["text"], line.get("voice", role), emotion=line.get("emotion"))
        else:
            pcm = _say_pcm(line["text"], SAY_VOICES.get(line.get("voice", role), "Samantha"))
        frames += pcm
        frames += b"\x00\x00" * int(elevenlabs.SAMPLE_RATE * line.get("pause", 0.7))
    out = call_dir(call_id) / "audio.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(elevenlabs.SAMPLE_RATE)
        w.writeframes(bytes(frames))
    return out


# ---- transcription ----

def transcribe(call_id: str, refresh: bool = False) -> dict:
    cached = None if refresh else cache.load_json("calls", call_id, "transcript.json")
    if cached:
        return cached
    audio = (call_dir(call_id) / "audio.wav").read_bytes()
    result = elevenlabs.stt(audio, "audio.wav")
    cache.save_json(result, "calls", call_id, "transcript.json")
    return result


def utterances(stt_result: dict, gap_s: float = 1.0, first_role: str = "dispatcher") -> list[dict]:
    """Group words into utterances by speaker change or pause. The first voice heard is `first_role`,
    the second the other of dispatcher/caller, any more are caller2, caller3..."""
    words = [w for w in stt_result.get("words") or [] if w.get("type") == "word"]
    order = [first_role, "caller" if first_role == "dispatcher" else "dispatcher"]
    roles: dict[str, str] = {}
    out: list[dict] = []
    for w in words:
        spk = w.get("speaker_id") or "speaker_0"
        if spk not in roles:
            roles[spk] = order[len(roles)] if len(roles) < 2 else f"caller{len(roles)}"
        role = roles[spk]
        if out and out[-1]["role"] == role and w["start"] - out[-1]["end"] < gap_s:
            out[-1]["text"] += " " + w["text"]
            out[-1]["end"] = w["end"]
        else:
            out.append({"role": role, "start": w["start"], "end": w["end"], "text": w["text"]})
    return out


# ---- live timeline ----

def build_timeline(call_id: str, refresh: bool = False) -> dict:
    """Re-extract the record after every caller utterance, like it would run live.
    Returns {utterances: [...], timeline: [{t, utterance_index, record}]}."""
    cached = None if refresh else cache.load_json("calls", call_id, "timeline.json")
    if cached:
        return cached
    script = cache.load_json("calls", call_id, "script.json")
    utts = utterances(transcribe(call_id))
    timeline, record = [], None
    for i, u in enumerate(utts):
        if u["role"] == "dispatcher":
            continue
        record = extract.extract(utts[: i + 1], script["building_id"], record)
        timeline.append({"t": u["end"], "utterance_index": i, "record": record})
    cache.save_json({"utterances": utts, "timeline": timeline}, "calls", call_id, "timeline.json")
    return cache.load_json("calls", call_id, "timeline.json")


def wav_bytes(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(elevenlabs.SAMPLE_RATE)
        w.writeframes(pcm)
    return buf.getvalue()
