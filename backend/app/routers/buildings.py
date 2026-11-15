"""Per-building endpoints: data layers, geometry (routes, mayday, evac, hose), dispatch, briefing and Q&A."""
from fastapi import APIRouter, Body, HTTPException, Query

from agent import ask as ask_agent
from agent import briefing as briefing_agent
from agent import simulation as simulation_agent
from agent import tour as tour_agent
from app import deps
from data import cache, layers
from dispatch import facts
from geometry import evac, wallfollow

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("")
def buildings():
    from ondemand import registry
    out, seen = [], set()
    for b in list(cache.buildings()) + list(registry.all()):
        if b["id"] in seen:
            continue
        seen.add(b["id"])
        try:
            c = layers.costar(b["id"])
        except FileNotFoundError:
            c = {}
        out.append({**b, "stories": c.get("stories"), "year_built": c.get("year_built"), "tenants": c.get("current_tenant_count")})
    return out


@router.get("/{bid}")
def building(bid: str):
    b = deps.building(bid)
    return {"building": b, "costar": layers.costar(bid), "outside": layers.outside(bid)}


@router.get("/{bid}/floorplan")
def floorplan(bid: str):
    deps.building(bid)
    return layers.floorplan(bid)


@router.get("/{bid}/routes")
def routes(bid: str, from_room: str = Query(..., description="room id, label or description"),
           avoid: str | None = Query(None, description="comma-separated rooms to route around (fire, smoke)")):
    deps.building(bid)
    rid = deps.room_id(bid, from_room)
    avoid_ids = deps.room_ids(bid, avoid)
    r = layers.nav(bid).to_exit(rid, avoid=avoid_ids)
    if r is None:
        raise HTTPException(404, "No route to an exit")
    r.pop("nodes", None)
    if avoid_ids:
        default = layers.nav(bid).to_exit(rid)
        r["rerouted"] = bool(default) and default["path"] != r["path"]
        r["avoided"] = avoid_ids
    return r


@router.get("/{bid}/tour")
def tour(bid: str, to_room: str = Query(..., description="target room id, label or description"),
         entry: str | None = Query(None, description="entry door id or side letter A-D (default: nearest exit door)"),
         exit: str | None = Query(None, description="exit door id or side letter for the way out (default: nearest)"),
         avoid: str | None = Query(None, description="comma-separated rooms to route the way out around (fire, smoke)")):
    """Clip data for the 3D viewer: the way in from an entry door to a room, and the way out, with step captions."""
    deps.building(bid)
    rid = deps.room_id(bid, to_room)
    t = tour_agent.Tour(layers.floorplan(bid), layers.nav(bid), layers.sides(bid).of_local)
    out = t.build(rid, entry, exit, deps.room_ids(bid, avoid))
    if out is None:
        raise HTTPException(404, "No route between an exit and that room")
    return {"building_id": bid, **out}




@router.get("/{bid}/simulation")
def simulation(bid: str, rooms: str = Query(..., description="comma-separated rooms in the order to check (ids or labels)"),
               entry: str | None = Query(None, description="entry door id or side letter A-D (default: nearest exit door to the first room)"),
               exit: str | None = Query(None, description="exit door id or side letter for the way out (default: nearest to the last room)"),
               avoid: str | None = Query(None, description="comma-separated rooms to route the way out around (fire, smoke)"),
               leave: bool = Query(True, description="false: stop in the last room, no way out")):
    """One run for the whole search: in through an entry door, every room in order, then out. Includes a `clip` for the 3D player."""
    deps.building(bid)
    ids = deps.room_ids(bid, rooms)
    if not ids:
        raise HTTPException(404, "No known rooms to simulate")
    out = simulation_agent.build(layers.floorplan(bid), layers.nav(bid), layers.sides(bid).of_local, ids, entry, exit,
                                 deps.room_ids(bid, avoid), with_out=leave)
    if out is None:
        raise HTTPException(404, "No route between an exit and those rooms")
    return {"building_id": bid, **out}


@router.get("/{bid}/mayday")
def mayday(bid: str, room: str = Query(..., description="room id, label, or the mayday call text")):
    deps.building(bid)
    return wallfollow.mayday(layers.floorplan(bid), deps.room_id(bid, room), layers.nav(bid), layers.sides(bid).of_local)


@router.get("/{bid}/evac")
def evacuation(bid: str, occupants: int | None = None):
    deps.building(bid)
    if occupants is None:
        occupants = briefing_agent.costar_hazards(layers.costar(bid), 1)[1]["employees_estimate"] or 30
    return evac.simulate(layers.floorplan(bid), occupants, layers.nav(bid))


@router.get("/{bid}/hose")
def hose(bid: str, to_room: str = Query(..., description="fire room id, label or description")):
    """Hose stretch from every entry door to a room, against a 200 ft preconnect."""
    deps.building(bid)
    return briefing_agent.hose_stretch(layers.floorplan(bid), layers.nav(bid), [deps.room_id(bid, to_room)], layers.sides(bid))


@router.post("/{bid}/dispatch")
def dispatch(bid: str, transcript: list[dict] = Body(..., embed=True), use_llm: bool | None = Body(None, embed=True)):
    """Dispatch record ready for the briefing: Gemini or offline rules, plus room candidates."""
    deps.building(bid)
    return facts.extract(transcript, bid, use_llm)


@router.post("/{bid}/briefing")
def briefing(bid: str, dispatch: dict | None = Body(None, embed=True), use_llm: bool | None = Body(None, embed=True)):
    deps.building(bid)
    if dispatch and not dispatch.get("fire_candidates"):
        dispatch = facts.resolve_rooms(facts.normalize(dispatch, bid), bid)
    return briefing_agent.build(bid, dispatch, use_llm)


@router.post("/{bid}/ask")
def ask(bid: str, question: str = Body(..., embed=True), dispatch: dict | None = Body(None, embed=True),
        use_llm: bool | None = Body(None, embed=True)):
    deps.building(bid)
    return ask_agent.ask(bid, question, dispatch, use_llm)
