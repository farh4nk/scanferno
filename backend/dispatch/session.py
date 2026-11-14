"""Live transcription sessions: a call happening now, fed by a mic recording, an uploaded file or typed lines.

Every update replaces the transcript so far (ElevenLabs STT of the audio so far, or utterances the browser
recognized itself) and returns the same shapes as /calls/{id}/live: utterances, record (with `corrections`),
briefing (with `changes`) and, when a caller says "mayday", wall-following directions. Extraction only reruns
when a caller line changed, so re-sending the same audio is cheap. Sessions live in memory; `save` turns one
into a replayable call under fixtures/calls/.
"""
import hashlib
import re
import time
import uuid

from agent import briefing as briefing_agent
from agent import changes
from data import cache, layers
from geometry import wallfollow

from . import elevenlabs, facts, history, pipeline
from .locate import locate

MAX_SESSIONS = 50
SESSIONS: dict[str, "Session"] = {}
MAYDAY = re.compile(r"\bmay ?day\b", re.I)


class Session:
    def __init__(self, building_id: str, use_llm: bool | None = None):
        self.id = uuid.uuid4().hex[:10]
        self.building_id = building_id
        self.use_llm = use_llm
        self.created = time.time()
        self.utterances: list[dict] = []
        self.record: dict | None = None
        self.briefing: dict | None = None
        self.mayday: dict | None = None
        self.timeline: list[dict] = []
        self.stt_result: dict | None = None
        self.audio: tuple[bytes, str] | None = None
        self._hist: dict = {}
        self._caller_key: str | None = None
        self._mayday_key: str | None = None
        self._address_key: str | None = None
        self.building_changed: bool = False

    def transcribe(self, audio: bytes, filename: str, first_role: str = "dispatcher") -> dict:
        """STT on the whole recording so far (MediaRecorder chunks concatenated, or an uploaded file)."""
        self.stt_result = elevenlabs.stt(audio, filename)
        self.audio = (audio, filename)
        return self.update(pipeline.utterances(self.stt_result, first_role=first_role))

    def update(self, utterances: list[dict]) -> dict:
        self.utterances = [{"role": u.get("role") or "caller", "text": u["text"].strip(),
                            "start": u.get("start", 0), "end": u.get("end", u.get("start", 0))}
                           for u in utterances if (u.get("text") or "").strip()]
        callers = [(i, u) for i, u in enumerate(self.utterances) if u["role"] != "dispatcher"]
        key = hashlib.sha1(repr([(u["role"], u["text"]) for _, u in callers]).encode()).hexdigest()
        extracted = False
        if callers and key != self._caller_key:
            self._caller_key = key
            self._extract(callers[-1])
            extracted = True
        self._check_mayday(callers)
        return self.state(extracted)

    def _extract(self, last: tuple[int, dict]):
        i, u = last
        bid = self.building_id
        self.record = facts.extract(self.utterances, bid, self.use_llm, previous=self.record)
        self.record["corrections"] = history.track(self._hist, self.record, u["end"])
        self._maybe_switch_building()
        bid = self.building_id
        new = briefing_agent.build(bid, self.record, use_llm=False)
        new["changes"] = changes.diff(self.briefing, new)
        self.briefing = new
        self.timeline.append({"t": u["end"], "utterance_index": i, "record": self.record})

    def _maybe_switch_building(self):
        """If the caller gave an address for a different known building, onboard it and switch."""
        addr = (self.record or {}).get("address")
        if not addr or addr == self._address_key:
            return
        self._address_key = addr
        from ondemand import OnboardError, resolve
        try:
            out = resolve.prepare_for_address(addr)
        except OnboardError:
            return
        if not out or out["building_id"] == self.building_id:
            return
        self.building_id = out["building_id"]
        self.building_changed = True
        self.mayday = None
        self._mayday_key = None
        # Re-resolve rooms against the new floor plan
        self.record = facts.extract(self.utterances, self.building_id, self.use_llm, previous=None)
        self.record["corrections"] = []
        self.briefing = None

    def _check_mayday(self, callers: list[tuple[int, dict]]):
        said = [u["text"] for _, u in callers if MAYDAY.search(u["text"])]
        if not said or said[-1] == self._mayday_key:
            return
        self._mayday_key = said[-1]
        bid = self.building_id
        c = locate(said[-1], layers.floorplan(bid), layers.nav(bid), top=1)
        if c:
            self.mayday = wallfollow.mayday(layers.floorplan(bid), c[0]["room_id"], layers.nav(bid), layers.sides(bid).of_local)

    def state(self, extracted: bool = False) -> dict:
        changed = self.building_changed
        self.building_changed = False
        return {"session_id": self.id, "building_id": self.building_id, "building_changed": changed,
                "utterances": self.utterances, "record": self.record, "briefing": self.briefing,
                "mayday": self.mayday, "updates": len(self.timeline), "extracted": extracted}

    def save(self, title: str | None = None) -> str:
        """Write the session as fixtures/calls/live-<id>/ so /calls/{id}/live replays it offline."""
        call_id = f"live-{self.id}"
        lines = [{"role": u["role"], "text": u["text"]} for u in self.utterances]
        script = {"building_id": self.building_id, "kind": "live",
                  "title": title or f"Live call {time.strftime('%H:%M', time.localtime(self.created))}", "lines": lines}
        cache.save_json(script, "calls", call_id, "script.json")
        cache.save_json({"utterances": self.utterances, "timeline": self.timeline}, "calls", call_id, "timeline.json")
        if self.stt_result:
            cache.save_json(self.stt_result, "calls", call_id, "transcript.json")
        if self.audio:
            data, name = self.audio
            ext = (name.rsplit(".", 1)[-1] if "." in name else "webm").lower()
            cache.save_bytes(data, "calls", call_id, f"audio.{ext}")
        return call_id


def create(building_id: str, use_llm: bool | None = None) -> Session:
    if len(SESSIONS) >= MAX_SESSIONS:
        SESSIONS.pop(min(SESSIONS, key=lambda k: SESSIONS[k].created))
    s = Session(building_id, use_llm)
    SESSIONS[s.id] = s
    return s


def get(session_id: str) -> Session | None:
    return SESSIONS.get(session_id)


def end(session_id: str) -> bool:
    return SESSIONS.pop(session_id, None) is not None
