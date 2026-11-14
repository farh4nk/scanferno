"""On-demand ready: catalog search hit → same fixtures + floor plan as the heroes (see ondemand/)."""
from fastapi import APIRouter, HTTPException, Query

from ondemand import OnboardError, prepare, status

router = APIRouter(prefix="/ondemand", tags=["ondemand"])


@router.get("/{key}")
def onboard_status(key: str):
    """Is this catalog / CoStar / Matterport / building id already ready? 404 if unknown."""
    s = status(key)
    if s is None:
        raise HTTPException(404, f"Unknown property {key}")
    return s


@router.post("/{key}")
def onboard(key: str, refresh: bool = Query(False), outside: bool = Query(True)):
    """Fetch Matterport vector (if needed), build floorplan, register the building. Idempotent."""
    try:
        return prepare(key, refresh=refresh, fetch_outside=outside)
    except OnboardError as e:
        raise HTTPException(422, str(e)) from e
