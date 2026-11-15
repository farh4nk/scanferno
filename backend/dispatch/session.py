"""Live transcription sessions: a call happening now, fed by a mic recording, an uploaded file or typed lines.

Every update replaces the transcript so far (ElevenLabs STT of the audio so far, or utterances the browser
recognized itself) and returns the same shapes as /calls/{id}/live: utterances, record (with `corrections`),
briefing (with `changes`, plus nested `heat` / `rescue`) and, when a caller says "mayday", wall-following
directions. Extraction only reruns when a caller line changed, so re-sending the same audio is cheap.
Sessions live in memory; `save` turns one into a replayable call under fixtures/calls/.
"""
import copy
import hashlib
import re
import threading
import time
import uuid

from agent import briefing as briefing_agent
from agent import changes, live_geometry
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
        self._lock = threading.RLock()
        self.utterances: list[dict] = []
        self.record: dict | None = None
        self.briefing: dict | None = None
        self.mayday: dict | None = None
        self.building_match: dict | None = None
        self.timeline: list[dict] = []
        self.stt_result: dict | None = None
        self.audio: tuple[bytes, str] | None = None
        self._auto_record: dict | None = None
        self.location_overrides = {"fire_room_id": None, "people": []}
        self._hist: dict = {}
        self._caller_key: str | None = None
        self._mayday_key: str | None = None
        self._address_key: str | None = None
        self._match_key: str | None = None

        self.building_changed: bool = False

    def minutes(self) -> float:
        return max(0.0, (time.time() - self.created) / 60.0)

    def transcribe(self, audio: bytes, filename: str, first_role: str = "dispatcher") -> dict:
        """STT on the whole recording so far (MediaRecorder chunks concatenated, or an uploaded file)."""
        self.stt_result = elevenlabs.stt(audio, filename)
        self.audio = (audio, filename)
        return self.update(pipeline.utterances(self.stt_result, first_role=first_role))

    def update(self, utterances: list[dict]) -> dict:
        with self._lock:
            return self._update(utterances)

    def _update(self, utterances: list[dict]) -> dict:
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
        self._auto_record = facts.extract(self.utterances, bid, self.use_llm, previous=self._auto_record)
        self.record = self._record_with_location_overrides(self._auto_record)
        self.record["corrections"] = history.track(self._hist, self.record, u["end"])
        self._resolve_address()
        self._maybe_switch_building()
        bid = self.building_id
        new = briefing_agent.build(bid, self.record, use_llm=False)
        live_geometry.attach(bid, self.record, new, self.minutes())
        new["changes"] = changes.diff(self.briefing, new)
        self.briefing = new
        self.timeline.append({"t": u["end"], "utterance_index": i, "record": self.record})

    def _resolve_address(self):
        addr = (self.record or {}).get("address")
        if not addr:
            return
        # Always publish match metadata for the UI chip / confirm path.
        if addr != getattr(self, "_match_key", None):
            self._match_key = addr
            self.building_match = live_geometry.resolve_address(addr)

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
        self.location_overrides = {"fire_room_id": None, "people": []}
        # Re-resolve rooms against the new floor plan
        self._auto_record = facts.extract(self.utterances, self.building_id, self.use_llm, previous=None)
        self.record = self._record_with_location_overrides(self._auto_record)
        self.record["corrections"] = []
        self.briefing = None

    def _record_with_location_overrides(self, record: dict) -> dict:
        out = copy.deepcopy(record)
        fp = layers.floorplan(self.building_id)
        rooms = {r["id"]: r for r in fp["rooms"]}
        labels = {rid: room["label"] for rid, room in rooms.items()}
        for person in out.get("trapped") or []:
            person.setdefault("location_source", "transcription")
            person.setdefault("manual", False)

        fire_room_id = self.location_overrides["fire_room_id"]
        out["fire_location_source"] = "transcription" if out.get("fire_room_ids") else None
        if fire_room_id:
            room = rooms[fire_room_id]
            out["fire_room_ids"] = [fire_room_id]
            out["fire_candidates"] = [{
                "room_id": fire_room_id, "label": room["label"], "confidence": 1.0,
                "why": "manually selected",
            }]
            out["fire_location_source"] = "manual"

        trapped = out.setdefault("trapped", [])
        for override in self.location_overrides["people"]:
            description = override["description"]
            person = next((p for p in trapped if p["description"].casefold() == description.casefold()), None)
            if person is None:
                if not override.get("manual"):
                    continue
                person = {
                    "description": description, "near": labels[override["room_id"]], "confidence": 1.0,
                    "needs_assist": False, "room_candidates": [], "manual": True,
                }
                trapped.append(person)
            room_id = override["room_id"]
            person.update({
                "room_id": room_id, "confidence": 1.0, "room_match": "manually selected",
                "room_candidates": [{
                    "room_id": room_id, "label": labels[room_id], "confidence": 1.0,
                    "why": "manually selected",
                }],
                "location_source": "manual",
            })
        out["location_overrides"] = copy.deepcopy(self.location_overrides)
        return out

    def set_locations(self, fire_room_id: str | None, people: list[dict]) -> dict:
        with self._lock:
            return self._set_locations(fire_room_id, people)

    def _set_locations(self, fire_room_id: str | None, people: list[dict]) -> dict:
        self.location_overrides = {
            "fire_room_id": fire_room_id,
            "people": copy.deepcopy(people),
        }
        if self._auto_record is None:
            self._auto_record = facts.extract([], self.building_id, use_llm=False)
        self.record = self._record_with_location_overrides(self._auto_record)
        t = self.utterances[-1].get("end", 0) if self.utterances else 0
        self.record["corrections"] = history.track(self._hist, self.record, t)
        previous = self.briefing
        new = briefing_agent.build(self.building_id, self.record, use_llm=False)
        live_geometry.attach(self.building_id, self.record, new, self.minutes())
        new["changes"] = changes.diff(previous, new)
        self.briefing = new
        if self.utterances:
            self.timeline.append({
                "t": t, "utterance_index": len(self.utterances) - 1, "record": self.record,
            })
        return self.state()

    def _check_mayday(self, callers: list[tuple[int, dict]]):
        said = [u["text"] for _, u in callers if MAYDAY.search(u["text"])]
        if not said or said[-1] == self._mayday_key:
            return
        self._mayday_key = said[-1]
        bid = self.building_id
        c = locate(said[-1], layers.floorplan(bid), layers.nav(bid), top=1)
        if c:
            self.mayday = wallfollow.mayday(layers.floorplan(bid), c[0]["room_id"], layers.nav(bid), layers.sides(bid).of_local)

    def tick(self) -> dict:
        """Recompute heat/rescue with elapsed minutes without re-extracting (quiet fire growth)."""
        with self._lock:
            if self.record and self.briefing:
                live_geometry.attach(self.building_id, self.record, self.briefing, self.minutes())
            return self.state()

    def set_building(self, building_id: str) -> dict:
        with self._lock:
            return self._set_building(building_id)

    def _set_building(self, building_id: str) -> dict:
        """Rebind the session to another building; keep utterances and re-run locate + briefing."""
        if building_id == self.building_id:
            return self.state()
        self.building_id = building_id
        self.mayday = None
        self._mayday_key = None
        self.briefing = None
        self._auto_record = None
        self.location_overrides = {"fire_room_id": None, "people": []}
        self._caller_key = None
        self._hist = {}
        callers = [(i, u) for i, u in enumerate(self.utterances) if u["role"] != "dispatcher"]
        if callers:
            self._caller_key = hashlib.sha1(repr([(u["role"], u["text"]) for _, u in callers]).encode()).hexdigest()
            self._extract(callers[-1])
            self._check_mayday(callers)
            return self.state(True)
        return self.state()

    def state(self, extracted: bool = False) -> dict:
        with self._lock:
            changed = self.building_changed
            self.building_changed = False
            return {"session_id": self.id, "building_id": self.building_id, "building_changed": changed,
                    "utterances": self.utterances, "record": self.record, "briefing": self.briefing,
                    "location_overrides": copy.deepcopy(self.location_overrides),
                    "mayday": self.mayday, "building_match": self.building_match,
                    "minutes": round(self.minutes(), 2), "started_at": self.created,
                    "updates": len(self.timeline), "extracted": extracted}

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
