import json
import logging
import random
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt
from backend.config import SECRET_KEY, ALGORITHM

logger = logging.getLogger(__name__)
router = APIRouter()

EXTRA_PERSON_SEC = 7.0
DEVICE_SEC       = 7.0
FACE_TURN_SEC    = 3.0


def _verify_token(token: str):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return True
    except JWTError:
        return False


def _score_from_flags(flags: dict) -> dict:
    face_turned      = flags.get("face_turned",      False)
    extra_person     = flags.get("extra_person",     False)
    device           = flags.get("device",           False)
    voice_confidence = flags.get("voice_confidence", None)  # 1–10 from frontend analysis

    # Confidence: use voice score if available, else estimate from visual cues
    if voice_confidence is not None:
        base_confidence = round(voice_confidence - (2.0 if face_turned else 0), 1)
    else:
        base_confidence = round(7.0 + random.uniform(-1.0, 1.5) - (2.0 if face_turned else 0), 1)

    base_nervousness = round(max(10.0 - base_confidence + random.uniform(-0.5, 0.5), 1.0), 1)
    base_engagement  = 3.0 if face_turned else round(7.0 + random.uniform(-1.0, 1.5), 1)

    confidence  = round(min(max(base_confidence,  1.0), 10.0), 1)
    nervousness = round(min(max(base_nervousness, 1.0), 10.0), 1)
    engagement  = round(min(base_engagement,            10.0), 1)

    posture_ok = not face_turned
    posture    = "Good posture ✓" if posture_ok else "Sit upright & face camera"

    warning = None
    if extra_person:
        warning = "Another person detected in frame."
    elif device:
        warning = "Electronic device detected!"
    elif face_turned:
        warning = "Please look at the camera."
    elif nervousness > 7.0:
        warning = "You seem nervous — take a breath."

    return {
        "confidence":  confidence,
        "nervousness": nervousness,
        "engagement":  engagement,
        "posture":     posture,
        "posture_ok":  posture_ok,
        "warning":     warning,
    }


@router.websocket("/ws/vision")
async def vision_ws(websocket: WebSocket, token: str = Query(...)):
    if not _verify_token(token):
        await websocket.close(code=4001)
        return

    await websocket.accept()
    logger.info("Vision WebSocket connected")

    # Per-session violation state
    violations = {"extra_person": 0, "device": 0, "face_turned": 0}
    timers     = {"extra_person": None, "device": None, "face_turned": None}
    counted    = {"extra_person": False, "device": False, "face_turned": False}

    thresholds = {
        "extra_person": EXTRA_PERSON_SEC,
        "device":       DEVICE_SEC,
        "face_turned":  FACE_TURN_SEC,
    }

    try:
        while True:
            raw = await websocket.receive_text()
            now = time.monotonic()

            try:
                flags = json.loads(raw)
            except Exception:
                await websocket.send_text(json.dumps({"error": "bad payload"}))
                continue

            # Build scores from flags
            result = _score_from_flags(flags)
            result["extra_person"] = flags.get("extra_person", False)
            result["device"]       = flags.get("device",       False)
            result["face_turned"]  = flags.get("face_turned",  False)

            # Violation timer logic
            new_violations = []

            for key in ("extra_person", "device", "face_turned"):
                flag = result[key]

                if flag:
                    if timers[key] is None:
                        timers[key]  = now
                        counted[key] = False
                    elif not counted[key]:
                        if now - timers[key] >= thresholds[key]:
                            violations[key] += 1
                            counted[key]     = True
                            new_violations.append(key)
                else:
                    timers[key]  = None
                    counted[key] = False

            result["violations"]     = violations.copy()
            result["new_violations"] = new_violations

            await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        logger.info("Vision WebSocket disconnected")
    except Exception as e:
        logger.error("Vision WebSocket error: %s", e)
