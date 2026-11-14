# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a fire officer (company officer or incident commander) reading a pre-entry briefing in the rig on the way to a structure fire, and on arrival before committing a crew. Seconds to read, high stakes, a moving vehicle, often at night, wearing gloves or glancing between radio traffic.

Secondary: hackathon judges watching a 2-minute demo (HackPrinceton 2026). They should be convinced because the tool reads like something an officer would really use, not because it is dressed up for the stage.

## Product Purpose

When a fire call comes in, Scanferno turns CoStar (building facts, tenants), Matterport (indoor floor plan) and Vexcel (aerials, roof, footprint) data into a pre-entry briefing in seconds: hazards, entry points, search plan, exit routes, and wall-following "mayday" directions for a lost crew. A live dispatch call is transcribed and turned into structured facts (floor, side, trapped people, conditions) that reshape the briefing as the caller talks.

Success: an officer knows where to enter, where to search first, where the trapped person probably is, and how the crew gets out, before the truck stops.

## Positioning

Fuses three commercial data layers (indoor scan, aerial imagery, property records) with the live 911 call, so the briefing changes while the caller is still speaking. Pre-plans today are static binders or blank; this one is generated per call and per building.

## Operating Context

- Fireground conventions: building sides A (street/front), B (left), C (rear), D (right); mayday procedure; wall-following (left or right hand) to find an exit; search order.
- Inputs arrive live: dispatcher/caller transcript lines, structured dispatch records with confidence, briefing updates, mayday events (SSE).
- Demo runs on cached data for 3 Houston hero buildings; main demo is Vibe Hobby (costar-239873).

## Capabilities and Constraints

Must keep every current feature in any redesign:
- Address search (hero buildings + CoStar properties) and property card
- Replay scripted calls (speed control) and live calls (mic, browser speech, typed, upload; save as fixture)
- Live transcript and structured dispatch record with confidence and change flashes
- Floor plan, 2D SVG and 3D Matterport viewer, with layers: maze heat, search order, exit routes, doors, windows; room selection
- Briefing: summary, alerts, hazards with sources, search plan, exit routes (fire-aware rerouting), hose stretch, caveats
- Aerial images (nadir + 4 obliques)
- Commander Q&A with highlight on the plan
- Mayday: wall-following directions out of a room
- Evacuation sim: clear time, bottleneck door, animated frames

Stack: React 18 + Vite in `frontend/`; Matterport webcomponent for 3D. `frontend/` is owned by the Visuals role (branch `ui`).

Undecided: tablet layout is not a hard requirement; theme (dark vs light) not fixed.

## Evidence on Hand

Real cached data in `fixtures/<building>/` (floorplan.json, briefing, aerial JPGs, CoStar facts) and 5 voiced calls in `fixtures/calls/`. No real 911 audio; calls are scripted. No testimonials or fire department endorsements exist; do not invent them.

## Product Principles

1. Glanceable under stress: the most important fact for the next decision is the largest thing on screen.
2. Every claim shows its source; stale or inferred data is labeled, never hidden.
3. Live data visibly reshapes the briefing; change is shown, not silently swapped.
4. Speak the fireground's language (sides, search order, mayday), not software jargon.
5. Supports judgment, never replaces on-scene verification.
