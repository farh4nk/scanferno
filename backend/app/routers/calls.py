"""Scripted dispatch calls: metadata, plain replay and the full live demo stream."""
import asyncio
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from agent import briefing as briefing_agent
from agent import changes, live_geometry
from app import sse
from data import cache, layers
from dispatch import facts, history, pipeline
from dispatch.locate import locate
from geometry import wallfollow

router = APIRouter(tags=["calls"])


@router.get("/calls")
def calls():
    return pipeline.list_calls()


@router.get("/calls/{call_id}")
def call(call_id: str):
    script = cache.load_json("calls", call_id, "script.json")
    if not script:
        raise HTTPException(404, f"no call {call_id}")
    return {
        "call_id": call_id,
        "script": script,
        "audio_url": pipeline.audio_url(call_id),
        **(cache.load_json("calls", call_id, "timeline.json") or {"utterances": [], "timeline": []}),
    }


@router.get("/calls/{call_id}/replay")
async def replay(call_id: str, speed: float = 1.0):
    """Server-sent events in call time: `utterance` when someone speaks, `record` when facts update.
    Start the audio at the same moment as the stream for a synced demo."""
    data = cache.load_json("calls", call_id, "timeline.json")
    if not data:
        raise HTTPException(404, f"no timeline for {call_id}; run scripts.process_calls")
    events = [(u["start"], "utterance", {"index": i, **u}) for i, u in enumerate(data["utterances"])]
    events += [(s["t"], "record", s) for s in data["timeline"]]
    events.sort(key=lambda e: e[0])

    async def stream():
        clock = 0.0
        for t, kind, payload in events:
            await asyncio.sleep(max(0.0, (t - clock) / speed))
            clock = t
            yield sse.event(kind, payload)
        yield sse.event("done", {})

    return StreamingResponse(stream(), media_type="text/event-stream")


def _script_utterances(script: dict) -> list[dict]:
    """Timing for calls that have no audio yet: ~2.6 words/s plus the script's pauses."""
    t, out = 0.0, []
    for line in script["lines"]:
        dur = max(1.0, len(line["text"].split()) / 2.6)
        out.append({"role": line["role"], "start": round(t, 2), "end": round(t + dur, 2), "text": line["text"]})
        t += dur + line.get("pause", 0.7)
    return out


_FRAMES: dict[str, dict] = {}


@router.get("/calls/{call_id}/frames")
def frames(call_id: str, refresh: bool = False):
    """The whole call precomputed, for a player that can seek: every utterance, plus one frame per caller line
    with the dispatch record, the rebuilt briefing (with `changes` since the previous frame) and, for mayday
    calls, the wall-following directions. Same logic as /live without the waiting; the client plays the audio
    and shows the last frame whose `t` has passed. Offline rules only, so it returns in a second or two."""
    if call_id in _FRAMES and not refresh:
        return _FRAMES[call_id]
    script = cache.load_json("calls", call_id, "script.json")
    if not script:
        raise HTTPException(404, f"no call {call_id}")
    bid = script["building_id"]
    data = cache.load_json("calls", call_id, "timeline.json")
    utts = data["utterances"] if data else _script_utterances(script)
    cached = {s["utterance_index"]: s["record"] for s in data["timeline"]} if data else {}
    out, record, brief, hist = [], None, None, {}
    for i, u in enumerate(utts):
        if u["role"] == "dispatcher":
            continue
        if script.get("kind") == "mayday":
            c = locate(u["text"], layers.floorplan(bid), layers.nav(bid), top=1)
            if c:
                m = wallfollow.mayday(layers.floorplan(bid), c[0]["room_id"], layers.nav(bid), layers.sides(bid).of_local)
                out.append({"t": u["end"], "utterance_index": i, "mayday": m})
            continue
        if i in cached:
            record = facts.resolve_rooms(facts.normalize(cached[i], bid), bid)
            record["extractor"] = "cached timeline"
        else:
            record = facts.extract(utts[: i + 1], bid, False, previous=record)
        record["corrections"] = history.track(hist, record, u["end"])
        new = briefing_agent.build(bid, record, use_llm=False)
        new["changes"] = changes.diff(brief, new)
        brief = new
        out.append({"t": u["end"], "utterance_index": i, "record": record, "briefing": brief})
    res = {
        "call_id": call_id, "building_id": bid, "kind": script.get("kind", "dispatch"), "title": script.get("title"),
        "audio_url": pipeline.audio_url(call_id), "duration": round(utts[-1]["end"], 2) if utts else 0.0,
        "utterances": utts, "frames": out,
    }
    _FRAMES[call_id] = res
    return res


@router.get("/calls/{call_id}/live")
def live(call_id: str, speed: float = 1.0, use_llm: bool | None = None):
    """The full demo stream for any call. Same `utterance` / `record` events as /replay, plus `briefing`
    (rebuilt after every record, with `changes` since the previous one) and `mayday` (wall-following
    directions, for mayday calls), then `done`. Records carry `corrections` (what the caller changed).
    Calls with a cached timeline replay its records; others are extracted as they go."""
    script = cache.load_json("calls", call_id, "script.json")
    if not script:
        raise HTTPException(404, f"no call {call_id}")
    bid = script["building_id"]
    data = cache.load_json("calls", call_id, "timeline.json")
    utts = data["utterances"] if data else _script_utterances(script)
    cached = {s["utterance_index"]: s["record"] for s in data["timeline"]} if data else {}

    def events():
        start = time.monotonic()
        record, brief, hist = None, None, {}
        for i, u in enumerate(utts):
            wait = u["start"] / max(speed, 0.01) - (time.monotonic() - start)
            if wait > 0:
                time.sleep(wait)
            yield sse.event("utterance", {"index": i, **u})
            if u["role"] == "dispatcher":
                continue
            if script.get("kind") == "mayday":
                c = locate(u["text"], layers.floorplan(bid), layers.nav(bid), top=1)
                if c:
                    yield sse.event("mayday", wallfollow.mayday(layers.floorplan(bid), c[0]["room_id"], layers.nav(bid), layers.sides(bid).of_local))
                continue
            if i in cached:
                record = facts.resolve_rooms(facts.normalize(cached[i], bid), bid)
                record["extractor"] = "cached timeline"
            else:
                record = facts.extract(utts[: i + 1], bid, use_llm, previous=record)
            record["corrections"] = history.track(hist, record, u["end"])
            match = live_geometry.resolve_address(record.get("address"))
            if match:
                yield sse.event("building_match", match)
            yield sse.event("record", {"t": u["end"], "utterance_index": i, "record": record})
            minutes = max(0.0, float(u.get("end") or 0) / 60.0)
            new = briefing_agent.build(bid, record, use_llm=False)
            live_geometry.attach(bid, record, new, minutes)
            new["changes"] = changes.diff(brief, new)
            brief = new
            yield sse.event("briefing", brief)
        if record is not None and (use_llm if use_llm is not None else facts.llm_available()):
            minutes = max(0.0, float(utts[-1].get("end") or 0) / 60.0) if utts else 0.0
            final = briefing_agent.build(bid, record, use_llm=True)
            live_geometry.attach(bid, record, final, minutes)
            final["changes"] = changes.diff(brief, final)
            yield sse.event("briefing", final)
        yield sse.event("done", {"elapsed_s": round(time.monotonic() - start, 1)})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
