"""The pre-entry briefing (briefing.json in docs/CONTRACTS.md): all three data layers + the dispatch facts.

Every hazard, entry point and ladder call comes from a rule over a specific data field, tagged with its
source, so the commander can see why it's there. Gemini (if configured) only rewrites the summary into
radio-style prose from those facts; it never adds facts. `trace` records each step for the UI.
"""
import datetime as dt
import json
import os

from data import layers
from dispatch.locate import neighbors
from geometry.sides import SIDE_NAMES

FLOOR_NAMES = {1: "FirstFloor", 2: "SecondFloor", 3: "ThirdFloor", 4: "FourthFloor", 5: "FifthFloor", 6: "SixthFloor"}
STORY_M = 3.6

INDUSTRY_HAZARDS = {
    "HealthCareAndSocialAssistance": ("medical", "high", "Medical tenant: oxygen cylinders likely; patients may need carrying."),
    "Manufacturing": ("fire_load", "high", "Manufacturing tenant: machinery, flammable liquids, heavy fire load."),
    "EducationalServices": ("life_hazard", "high", "Educational tenant: children or students may be inside."),
    "AccommodationAndFoodServices": ("kitchen", "med", "Food service: commercial kitchen with grease and gas."),
    "PersonalServices": ("chemicals", "med", "Personal services (salon, dry cleaning): flammable chemicals and aerosols."),
    "RetailersOrWholesalers": ("fire_load", "med", "Retail / wholesale stock: elevated fire load."),
    "Construction": ("chemicals", "med", "Construction tenant: possible fuel, tools and materials stored."),
    "FinancialInstitutions": ("entry", "low", "Financial tenant: vaults and reinforced doors slow forcible entry."),
    "MiningQuarryingAndOilAndGasExtraction": ("chemicals", "low", "Oil and gas office tenant: verify no samples or chemicals on site."),
}
SEVERITY_ORDER = {"high": 0, "med": 1, "low": 2}


def _hz(kind, severity, text, source, **extra) -> dict:
    return {"kind": kind, "severity": severity, "text": text, "source": source, **{k: v for k, v in extra.items() if v is not None}}


def _ladder_for(height_m: float | None) -> str:
    if height_m is None:
        return "ladder size unknown (no roof height)"
    if height_m <= 6:
        return "24 ft ground ladder reaches the roof"
    if height_m <= 10:
        return "35 ft ground ladder reaches the roof"
    return f"aerial device needed (roof about {height_m:.0f} m / {height_m * 3.28:.0f} ft)"


def costar_hazards(c: dict, floor: int | None) -> tuple[list, dict]:
    hz = []
    tenants = c.get("tenants") or []
    on_floor = [t for t in tenants if floor and t.get("floor") == FLOOR_NAMES.get(floor)]
    pool = on_floor or tenants
    seen = set()
    for t in pool:
        ind = t.get("industry")
        if ind in INDUSTRY_HAZARDS and ind not in seen:
            seen.add(ind)
            kind, sev, text = INDUSTRY_HAZARDS[ind]
            where = f" ({t['name']}, suite {t['suite']})" if t.get("suite") else f" ({t['name']})"
            hz.append(_hz(kind, sev, text.rstrip(".") + where + ".", "costar"))
    mat = (c.get("construction_material") or "").lower()
    if mat in ("steel", "metal"):
        hz.append(_hz("collapse", "high", f"{c['construction_material']} construction: unprotected steel and bar-joist roofs can fail early.", "costar"))
    elif mat == "masonry":
        hz.append(_hz("collapse", "med", "Masonry walls: watch parapets; set collapse zone at 1.5x wall height.", "costar"))
    elif mat in ("wood", "woodframe", "frame"):
        hz.append(_hz("collapse", "high", "Wood frame: fast fire spread in void spaces, early collapse.", "costar"))
    yb = c.get("year_built")
    if yb and yb < 1981:
        hz.append(_hz("asbestos", "low", f"Built {yb}: asbestos likely in older materials; full SCBA through overhaul.", "costar"))
    sp = c.get("has_sprinklers")
    if sp is True:
        hz.append(_hz("sprinklers", "low", "Sprinklered: supply the FDC early.", "costar"))
    elif sp is None:
        hz.append(_hz("sprinklers", "med", "Sprinkler status unknown.", "costar"))
    else:
        hz.append(_hz("sprinklers", "high", "Not sprinklered.", "costar"))
    if c.get("vacant"):
        hz.append(_hz("vacant", "high", "Building listed vacant: holes, missing stairs and squatters are common in fatal vacant fires.", "costar"))
    employees = sum(t.get("employees") or 0 for t in pool)
    occupancy = {
        "floor": floor, "tenants_on_floor": len(on_floor), "tenants_total": len(tenants),
        "employees_on_floor": sum(t.get("employees") or 0 for t in on_floor) if on_floor else None,
        "employees_estimate": employees,
        "tenant_names": [t["name"] for t in pool if t.get("name") and t["name"] != "Unknown tenant"][:8],
    }
    return hz, occupancy


def vexcel_hazards(o: dict) -> list:
    hz = []
    roof = o.get("roof") or {}
    defects = roof.get("defects") or {}
    pool = defects.get("water-pooling")
    if pool and pool > 20:
        hz.append(_hz("collapse", "high", f"Ponding water on {pool:.0f}% of the roof: extra dead load, keep roof crews off or minimal.", "vexcel"))
    if "structural-damage" in defects:
        hz.append(_hz("collapse", "high", "Roof structural damage detected in imagery.", "vexcel"))
    if "missing-material" in defects:
        hz.append(_hz("roof", "med", "Missing roof material detected: weak spots under foot.", "vexcel"))
    if roof.get("solar"):
        hz.append(_hz("solar", "high", "Solar panels on roof: stay energized in daylight and block vertical ventilation.", "vexcel"))
    if roof.get("skylights"):
        hz.append(_hz("roof", "med", f"{roof['skylights']} skylight(s): fall-through hazard for roof crews (also ready-made vent openings).", "vexcel"))
    if roof.get("ac_units", 0) >= 3:
        hz.append(_hz("collapse", "med", f"{roof['ac_units']} rooftop HVAC units: concentrated loads on the roof deck; shut down HVAC to slow smoke spread.", "vexcel"))
    area = o.get("footprint_area_m2")
    if area and area > 2000:
        hz.append(_hz("disorientation", "med", f"Large footprint ({area:,} m²): large enclosed floor areas are where crews get lost; use search lines.", "vexcel"))
    return hz


def matterport_hazards(fp: dict) -> list:
    hz = []
    detail = fp.get("maze_detail") or {}
    rooms = {r["id"]: r for r in fp["rooms"]}
    worst = sorted(fp.get("maze_score", {}).items(), key=lambda kv: -kv[1])[:3]
    for rid, score in worst:
        if score >= 0.6:
            why = "; ".join(detail.get(rid, {}).get("why") or [])
            hz.append(_hz("disorientation", "med" if score < 0.85 else "high",
                          f"{rooms[rid]['label']}: maze score {score:.2f} ({why}).", "matterport", room_id=rid))
    for r in fp["rooms"]:
        if r["type"] == "open_area" and r.get("area_m2", 0) > 120:
            hz.append(_hz("disorientation", "med", f"{r['label']} is {r['area_m2']:.0f} m² of open floor: no walls to follow, use a search rope.", "matterport", room_id=r["id"]))
    narrow = [d for d in fp["doors"] if d["width_m"] < 0.8 and not d.get("inferred")]
    if narrow:
        hz.append(_hz("egress", "low", f"{len(narrow)} doorway(s) under 0.8 m: tight with SCBA and when dragging a victim.", "matterport"))
    return hz


def dispatch_hazards(d: dict) -> list:
    hz = []
    for h in d.get("hazards") or []:
        sev = "high" if any(k in h for k in ("gas", "oxygen", "propane", "chemical", "power")) else "med"
        hz.append(_hz("reported", sev, f"Caller reports {h}.", "dispatch"))
    for p in d.get("trapped") or []:
        if p.get("needs_assist"):
            hz.append(_hz("life_hazard", "high", f"Reported victim ({p['description']}) needs assistance to move.", "dispatch", room_id=p.get("room_id")))
    return hz


def entry_points(fp: dict, nav, d: dict, sides) -> list:
    exits = [x for x in fp["doors"] if x["is_exit"]]
    rooms = {r["id"]: r for r in fp["rooms"]}
    victims = [p["room_id"] for p in d.get("trapped") or [] if p.get("room_id")]
    fire = d.get("fire_room_ids") or []
    fire_side = d.get("side")
    out = []
    for x in exits:
        dist = nav.exit_distances
        to_victim = min((dist(v).get(x["id"], 1e9) for v in victims), default=None)
        to_fire = min((dist(f).get(x["id"], 1e9) for f in fire), default=None)
        room = rooms.get(x["rooms"][0], {})
        side = x.get("side") or sides.of_local(x["position"])
        text = f"Side {side}: {x['width_m']:.1f} m door into {room.get('label', 'the building')}"
        if to_victim is not None and to_victim < 1e9:
            text += f", {to_victim:.0f} m to the reported victim"
        if to_fire is not None and to_fire < 1e9:
            text += f", {to_fire:.0f} m to the fire area"
        if x.get("inferred"):
            text += " (inferred from aerial, verify on arrival)"
        sources = ["vexcel", "matterport"] if x.get("inferred") else ["matterport"]
        if (to_victim is not None and to_victim < 1e9) or (to_fire is not None and to_fire < 1e9):
            sources.append("dispatch")
        out.append({"side": side, "door_id": x["id"], "text": text + ".", "sources": sources,
                    "_victim": to_victim if to_victim is not None else 1e9, "_fire": to_fire if to_fire is not None else 1e9,
                    "_unburned": side != fire_side})
    if victims:
        out.sort(key=lambda e: e["_victim"])
        if out:
            out[0]["role"] = "search"
    attack = sorted([e for e in out if e["_unburned"]] or out, key=lambda e: e["_fire"])
    if attack and fire:
        attack[0].setdefault("role", "attack")
        if attack[0].get("role") == "search" and len(attack) > 1:
            attack[1]["role"] = "attack"
    for e in out:
        for k in ("_victim", "_fire", "_unburned"):
            e.pop(k)
    return out


def ladder_positions(o: dict, fp: dict, d: dict, floor: int | None) -> list:
    out = []
    h = o.get("roof_height_m")
    asides = o.get("sides") or {}
    wanted = ["A"] + ([d["side"]] if d.get("side") and d["side"] != "A" else [])
    for s in wanted:
        info = asides.get(s)
        if not info:
            continue
        out.append({"side": s, "text": f"Side {s} ({SIDE_NAMES[s]}): {_ladder_for(h)}.", "lat": info["staging_lat"], "lon": info["staging_lon"],
                    "purpose": "roof access / ventilation" if s != "A" else "aerial staging",
                    "sources": ["vexcel", "dispatch"] if s != "A" else ["vexcel"]})
    victim_rooms = {p["room_id"] for p in d.get("trapped") or [] if p.get("room_id")}
    level = ((floor or 1) - 1) * STORY_M
    for w in fp.get("windows") or []:
        if w.get("exterior") and w["room_id"] in victim_rooms:
            room = next(r for r in fp["rooms"] if r["id"] == w["room_id"])
            sill = level + (w.get("sill_m") or 0)
            reach = "ground-level window, no ladder needed" if sill < 1.5 else f"sill about {sill:.1f} m up, {_ladder_for(sill + 1)}"
            info = asides.get(w.get("side"), {})
            out.append({"side": w.get("side"), "text": f"VES: window into {room['label']} on side {w.get('side')} ({reach}).",
                        "lat": info.get("staging_lat"), "lon": info.get("staging_lon"), "purpose": "vent-enter-search", "window_id": w["id"],
                        "sources": ["matterport", "dispatch", "vexcel"]})
            break
    return out


def search_plan(fp: dict, d: dict, limit: int = 8) -> list:
    rooms = {r["id"]: r for r in fp["rooms"]}
    adj = neighbors(fp)
    plan, seen = [], set()

    def add(rid, reason, sources):
        if rid in rooms and rid not in seen and len(plan) < limit:
            seen.add(rid)
            plan.append({"room_id": rid, "label": rooms[rid]["label"], "reason": reason, "sources": sources})

    for p in sorted(d.get("trapped") or [], key=lambda p: -p.get("confidence", 0)):
        for i, c in enumerate(p.get("room_candidates") or []):
            if i == 0 or c["confidence"] >= 0.5 * p["room_candidates"][0]["confidence"]:
                add(c["room_id"], f"Reported {p['description']} ({c['why']}, {c['confidence']:.0%})" if i == 0
                    else f"Alternate location for {p['description']} ({c['why']})", ["dispatch", "matterport"])
    for rid in d.get("fire_room_ids") or []:
        add(rid, "Reported fire area", ["dispatch"])
    for rid in d.get("fire_room_ids") or []:
        for n in sorted(adj.get(rid, ())):
            add(n, f"Next to the fire area ({rooms[rid]['label']})", ["dispatch", "matterport"])
    for rid, score in sorted((fp.get("maze_score") or {}).items(), key=lambda kv: -kv[1]):
        if rooms[rid]["type"] not in ("hallway", "open_area"):
            add(rid, f"Hard to self-evacuate (maze score {score:.2f})", ["matterport"])
    return plan


def exit_routes(fp: dict, nav, plan: list, fire: list) -> list:
    """Exit route for each search-plan room, routed around the fire area when one is known."""
    cached = fp.get("exit_routes") or {}
    out = []
    for p in plan:
        rid = p["room_id"]
        default = cached.get(rid)
        if not fire:
            if default:
                out.append({**{k: v for k, v in default.items() if k != "nodes"}, "sources": ["matterport"]})
            continue
        r = nav.to_exit(rid, avoid=fire)
        if r is None:
            continue
        r.pop("nodes", None)
        r["rerouted"] = bool(default) and default["path"] != r["path"]
        r["sources"] = ["matterport", "dispatch"]
        out.append(r)
    return out


PRECONNECT_FT = 200
APPARATUS_SETBACK_M = 15.0  # pump panel to the entry door, assumed


def hose_stretch(fp: dict, nav, fire: list, sides) -> list:
    """Hose length from each exterior door to the nearest fire room, against a 200 ft preconnect."""
    rooms = {r["id"]: r for r in fp["rooms"]}
    best: dict[str, tuple[float, str]] = {}
    for rid in fire:
        for door_id, m in nav.exit_distances(rid).items():
            if door_id not in best or m < best[door_id][0]:
                best[door_id] = (m, rid)
    out = []
    for door_id, (m, rid) in sorted(best.items(), key=lambda kv: kv[1][0]):
        door = nav.doors[door_id]
        ft = round((m + APPARATUS_SETBACK_M) * 3.281)
        fits = ft <= PRECONNECT_FT
        side = door.get("side") or sides.of_local(door["position"])
        out.append({"door_id": door_id, "side": side, "to_room_id": rid, "interior_m": m, "total_ft": ft, "fits_preconnect": fits,
                    "text": f"Side {side} door to {rooms[rid]['label']}: about {ft} ft of hose"
                            + ("" if fits else f", beyond a {PRECONNECT_FT} ft preconnect") + ".",
                    "sources": ["matterport", "dispatch"]})
    return out


def _summary_template(b, c, o, d, occ, plan, hazards) -> str:
    parts = []
    stories = c.get("stories")
    desc = " ".join(str(x) for x in (f"{stories}-story" if stories else None, c.get("year_built"),
                                     (c.get("construction_material") or "").lower() or None,
                                     (c.get("property_type") or "building").lower()) if x)
    sprk = {True: "sprinklered", False: "not sprinklered"}.get(c.get("has_sprinklers"), "sprinklers unknown")
    roof = f", roof about {o['roof_height_m']:.0f} m" if o.get("roof_height_m") else ""
    parts.append(f"{desc.capitalize()}, {sprk}{roof}.")
    fire = []
    if d.get("side"):
        fire.append(f"{SIDE_NAMES[d['side']]} side")
    if d.get("floor"):
        fire.append(f"floor {d['floor']}")
    if fire or d.get("conditions"):
        cond = ", ".join(d.get("conditions") or [])
        parts.append(f"Fire reported {' '.join(fire) or 'location unknown'}" + (f" with {cond}" if cond else "") + ".")
    trapped = [p for p in d.get("trapped") or []]
    if trapped:
        names = []
        for p in trapped:
            where = next((x["label"] for x in plan if x["room_id"] == p.get("room_id")), None)
            names.append(f"{p['description']}" + (f" likely in {where}" if where else "") + (" (needs assistance)" if p.get("needs_assist") else ""))
        parts.append("Trapped: " + "; ".join(names) + ".")
    if occ.get("employees_estimate"):
        parts.append(f"About {occ['employees_estimate']} occupants across {occ['tenants_on_floor'] or occ['tenants_total']} tenants.")
    top = [h for h in hazards if h["severity"] == "high"][:2]
    if top:
        parts.append("Watch: " + " ".join(h["text"] for h in top))
    return " ".join(parts)


def _summary_llm(facts: dict) -> str:
    from agent import llm
    system = ("You are a fire officer giving a 3-sentence radio size-up from a pre-incident briefing. "
              "Use only the facts given, lead with life safety, use fireground sides (Alpha, Bravo, Charlie, Delta). No markdown.")
    return llm.generate(json.dumps(facts, default=str), system=system).strip()


def build(bid: str, dispatch: dict | None = None, use_llm: bool | None = None) -> dict:
    d = dispatch or {}
    b, c, o, fp = layers.building(bid), layers.costar(bid), layers.outside(bid), layers.floorplan(bid)
    nav, sides = layers.nav(bid), layers.sides(bid)
    floor = d.get("floor") or 1
    trace = [
        {"step": "costar", "text": f"CoStar: {c.get('building_name')}, {c.get('current_tenant_count')} tenants, built {c.get('year_built')}."},
        {"step": "vexcel", "text": f"Vexcel: {o['roof']['material']} roof, height {o.get('roof_height_m')} m, {o['roof']['skylights']} skylights, solar {'yes' if o['roof']['solar'] else 'no'}."},
        {"step": "matterport", "text": f"Matterport: {len(fp['rooms'])} rooms, {len(fp['doors'])} doors, {sum(1 for x in fp['doors'] if x['is_exit'])} exits."},
    ]
    for p in d.get("trapped") or []:
        if p.get("room_id"):
            top = p["room_candidates"][0]
            trace.append({"step": "locate", "text": f"\"{p.get('near')}\" -> {top['label']} ({top['why']}, {top['confidence']:.0%})."})

    ch, occ = costar_hazards(c, floor)
    hazards = dispatch_hazards(d) + vexcel_hazards(o) + matterport_hazards(fp) + ch
    hazards.sort(key=lambda h: SEVERITY_ORDER[h["severity"]])
    plan = search_plan(fp, d)
    fire = [r for r in d.get("fire_room_ids") or [] if r in nav.rooms]
    routes = exit_routes(fp, nav, plan, fire)
    hose = hose_stretch(fp, nav, fire, sides)
    rooms = {r["id"]: r["label"] for r in fp["rooms"]}
    for r in routes:
        if r.get("rerouted"):
            trace.append({"step": "reroute", "text": f"Exit route from {rooms[r['from_room_id']]} rerouted around the fire area ({r['distance_m']} m)."})
        if r.get("through_avoided"):
            hazards.append(_hz("egress", "high", f"Only way out of {rooms[r['from_room_id']]} passes the fire area "
                               f"({', '.join(rooms[x] for x in r['through_avoided'])}).", "matterport", room_id=r["from_room_id"]))
    if hose and not hose[0]["fits_preconnect"]:
        hazards.append(_hz("hose", "med", f"Fire area is about {hose[0]['total_ft']} ft of hose from the nearest door (side {hose[0]['side']}): "
                           f"a {PRECONNECT_FT} ft preconnect won't reach; extend the line.", "matterport"))
    hazards.sort(key=lambda h: SEVERITY_ORDER[h["severity"]])
    trapped = [{"room_id": p.get("room_id"), "description": p["description"], "confidence": p.get("confidence"),
                "needs_assist": p.get("needs_assist", False), "candidates": p.get("room_candidates", [])}
               for p in d.get("trapped") or []]
    entries = entry_points(fp, nav, d, sides)
    ladders = ladder_positions(o, fp, d, floor)
    trace.append({"step": "plan", "text": f"{len(hazards)} hazards, {len(entries)} entry points, {len(plan)} rooms in the search plan."})

    caveats = [
        f"Interior plan is one Matterport scan ({fp['floors'][0]['label']}); other floors assumed similar." if (c.get("stories") or 1) > 1 else
        "Interior plan is from one Matterport scan.",
        "Supports, does not replace, on-scene size-up and command judgment.",
    ]
    if any(x.get("inferred") for x in fp["doors"]):
        caveats.append("Doors marked inferred were added where the scan had none; verify on arrival.")
    if not b.get("scan_rotation_verified"):
        caveats.append("Scan orientation to the street is assumed; side letters inside are approximate.")
    if o.get("imagery_date_ms"):
        caveats.append(f"Aerial imagery from {dt.datetime.fromtimestamp(o['imagery_date_ms'] / 1000, dt.UTC):%b %Y}.")

    summary = _summary_template(b, c, o, d, occ, plan, hazards)
    if use_llm if use_llm is not None else bool(os.getenv("GEMINI_API_KEY")):
        try:
            summary = _summary_llm({"building": {k: c.get(k) for k in ("building_name", "address", "stories", "year_built", "construction_material", "has_sprinklers")},
                                    "roof_height_m": o.get("roof_height_m"), "dispatch": {k: d.get(k) for k in ("floor", "side", "conditions", "hazards")},
                                    "trapped": trapped, "occupancy": occ, "top_hazards": hazards[:5], "search_plan": plan[:3], "entry_points": entries[:2]})
            trace.append({"step": "summary", "text": "Gemini wrote the size-up from the facts above."})
        except Exception as e:
            trace.append({"step": "summary", "text": f"Gemini unavailable ({type(e).__name__}); template summary."})

    return {
        "building_id": bid,
        "generated_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "building": {"name": b.get("name"), "address": b.get("address"), "lat": b.get("lat"), "lon": b.get("lon"),
                     "stories": c.get("stories"), "year_built": c.get("year_built"), "construction": c.get("construction_material"),
                     "sprinklers": c.get("has_sprinklers"), "roof_height_m": o.get("roof_height_m"),
                     "footprint_area_m2": o.get("footprint_area_m2"), "front": b.get("front", "S")},
        "summary": summary,
        "hazards": hazards,
        "entry_points": entries,
        "ladder_positions": ladders,
        "search_plan": plan,
        "exit_routes": routes,
        "hose_stretch": hose,
        "trapped": trapped,
        "fire_room_ids": d.get("fire_room_ids") or [],
        "occupancy": occ,
        "sides": o.get("sides") or {},
        "footprint_wkt": o.get("footprint_wkt"),
        "images": o.get("images") or {},
        "caveats": caveats,
        "trace": trace,
    }
