import base64
import logging
import random
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.routes.auth import get_current_user
from backend.models.database import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/realtime", tags=["realtime"])


class FrameRequest(BaseModel):
    frame: str  # base64 JPEG


def _analyze_frame(frame_bytes: bytes) -> dict:
    """
    Lightweight heuristic using pixel brightness as a proxy for engagement/confidence.
    Swap _analyze_frame body with DeepFace or MediaPipe when ready — nothing else changes.
    """
    try:
        sample = frame_bytes[len(frame_bytes) // 4: len(frame_bytes) // 4 + 600]
        brightness = sum(sample) / max(len(sample), 1) / 255.0

        confidence  = round(min(brightness * 10 + 1.5, 10.0), 1)
        engagement  = round(min(brightness * 12, 10.0), 1)
        nervousness = round(max(10.0 - engagement - random.uniform(0, 1.5), 1.0), 1)
        posture     = "Good" if brightness > 0.4 else "Adjust lighting / sit upright"

        return {"confidence": confidence, "nervousness": nervousness,
                "engagement": engagement, "posture": posture}
    except Exception as e:
        logger.warning("Frame analysis failed: %s", e)
        return {"confidence": 5.0, "nervousness": 5.0, "engagement": 5.0, "posture": "Unknown"}


@router.post("/analyze-frame")
def analyze_frame(data: FrameRequest, current_user: User = Depends(get_current_user)):
    try:
        frame_bytes = base64.b64decode(data.frame)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 frame")
    return _analyze_frame(frame_bytes)
