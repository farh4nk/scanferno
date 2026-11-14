"""Building-agnostic dispatch endpoints: typed extraction and audio transcription."""
from fastapi import APIRouter, UploadFile
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
async def dispatch_transcribe(file: UploadFile):
    """Upload a recording, get speaker-separated utterances."""
    result = elevenlabs.stt(await file.read(), file.filename or "call.wav")
    return {"text": result.get("text"), "utterances": pipeline.utterances(result)}
