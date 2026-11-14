"""Building-agnostic dispatch endpoints: typed extraction and audio transcription."""
from fastapi import APIRouter, Form, HTTPException, UploadFile
from pydantic import BaseModel

from dispatch import elevenlabs, extract, pipeline

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


class ExtractRequest(BaseModel):
    building_id: str | None = None
    transcript: list[dict]  # [{role, text}]
    previous: dict | None = None


@router.post("/extract")
def dispatch_extract(req: ExtractRequest):
    """Typed fallback and live mode: send the transcript so far, get the updated record."""
    return extract.extract(req.transcript, req.building_id, req.previous)


@router.post("/transcribe")
async def dispatch_transcribe(file: UploadFile, first_role: str = Form("dispatcher")):
    """Upload a recording, get speaker-separated utterances."""
    try:
        result = elevenlabs.stt(await file.read(), file.filename or "call.wav")
    except elevenlabs.NotConfigured as e:
        raise HTTPException(503, str(e))
    return {"text": result.get("text"), "utterances": pipeline.utterances(result, first_role=first_role)}
