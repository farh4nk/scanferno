"""Attach fire heat + per-person rescue routes to a briefing for live / replay streams.

Gemini never invents geometry: heat comes from geometry/heat.py and routes from agent/rescue.py.
CoStar / Vexcel / maze scores only nudge risk weights.
"""
from agent import briefing as briefing_agent
from agent import rescue
from data import directory, layers


def risk_context(bid: str, floor: int | None) -> dict:
    """Numeric risk modifiers from cached CoStar, Vexcel and maze score (no live API calls)."""
    c, o, fp = layers.costar(bid), layers.outside(bid), layers.floorplan(bid)
    risk_bump, room_bump, window_extra_s, notes = 0.0, {}, 0.0, []
    mat = (c.get("construction_material") or "").lower()
    if mat in ("steel", "metal"):
        risk_bump += 0.45
        notes.append(f"{c.get('construction_material')} construction")
    elif mat in ("wood", "woodframe", "frame"):
        risk_bump += 0.5
        notes.append("wood frame")
    if c.get("vacant"):
        risk_bump += 0.5
        notes.append("vacant")
    if c.get("has_sprinklers") is False:
        risk_bump += 0.15
        notes.append("no sprinklers")
    hz, _ = briefing_agent.costar_hazards(c, floor)
    if any(h.get("severity") == "high" and h.get("source") == "costar" for h in hz):
        risk_bump += 0.25
        notes.append("high CoStar life/fire hazard")
    for rid, score in (fp.get("maze_score") or {}).items():
        if score >= 0.6:
            room_bump[rid] = round(0.15 * float(score), 2)
    roof = o.get("roof") or {}
    if roof.get("solar"):
        window_extra_s = 60.0
        notes.append("solar on roof: prefer door entry over VES")
    if "structural-damage" in (roof.get("defects") or {}):
        risk_bump += 0.2
        notes.append("roof structural damage")
    return {"risk_bump": risk_bump, "room_bump": room_bump, "window_extra_s": window_extra_s, "notes": notes}


def slim_heat(heat: dict | None) -> dict | None:
    """Drop the cell grid from live payloads; room zones are enough for the map."""
    if not heat:
        return None
    return {k: heat[k] for k in ("fire_room_ids", "spread_m", "minutes", "conditions",
                                 "rooms", "zones", "thresholds") if k in heat}


def attach(bid: str, dispatch: dict | None, briefing: dict, minutes: float = 0.0) -> dict:
    """Nest `heat` + `rescue` on an existing briefing dict (mutates and returns it)."""
    d = dispatch or {}
    ctx = risk_context(bid, d.get("floor"))
    heat = rescue.build_heat(bid, d, minutes)
    plan = rescue.plan(bid, d, heat, risk_bump=ctx["risk_bump"], room_bump=ctx["room_bump"],
                       window_extra_s=ctx["window_extra_s"])
    if ctx["notes"]:
        plan = {**plan, "factors": ctx["notes"]}
    briefing["heat"] = slim_heat(heat)
    briefing["rescue"] = plan
    briefing["minutes"] = round(max(0.0, minutes), 2)
    return briefing


def resolve_address(address: str | None) -> dict | None:
    """Match a spoken address to a known building. `auto` only when ready + score >= GOOD_SCORE."""
    q = (address or "").strip()
    if not q:
        return None
    results = directory.search(q, limit=3)
    if not results:
        return {"query": q, "hit": None, "auto": False}
    top = results[0]
    hit = {k: top.get(k) for k in ("id", "building_id", "name", "address", "status", "score", "match")}
    auto = (top.get("status") == "ready" and (top.get("score") or 0) >= directory.GOOD_SCORE
            and bool(top.get("building_id")))
    return {"query": q, "hit": hit, "auto": auto}
