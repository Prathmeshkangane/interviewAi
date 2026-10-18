"""
Body-language score computed from REAL webcam signals sent by the frontend.

Previously this number was invented by Gemini, which only ever saw average stress and
confidence. Here it is a transparent weighted blend:

    eye contact / head direction   40%   share of face-visible time the head faced the camera
    posture                        25%   share of face-visible time the face stayed close to its baseline size
    composure                      20%   calm expression (1 - avg stress) blended with a normal blink rate
    expressiveness                 15%   smiles per minute (neutral professional face is not punished hard)

If the camera analysis was unavailable or the face was visible too little, the score is
None (the UI shows "not scored") instead of a made-up number.
"""
from typing import Any, Optional

MIN_FRAMES = 16          # roughly 2 seconds of analysed video
MIN_FACE_RATIO = 0.5     # face must be visible for at least half of the frames

WEIGHTS = {
    "eye_contact": 0.40,
    "posture": 0.25,
    "composure": 0.20,
    "expressiveness": 0.15,
}


def _get(obj: Any, name: str, default: float = 0.0) -> float:
    if obj is None:
        return default
    value = obj.get(name, default) if isinstance(obj, dict) else getattr(obj, name, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _unavailable(note: str) -> dict:
    return {"available": False, "score": None, "components": None, "note": note}


def score_body_language(signals: Optional[Any]) -> dict:
    if signals is None:
        return _unavailable("No camera data was sent, so body language was not scored.")

    available = bool(
        signals.get("available") if isinstance(signals, dict) else getattr(signals, "available", False)
    )
    if not available:
        return _unavailable("Camera analysis was unavailable, so body language was not scored.")

    frames = _get(signals, "frames_analyzed")
    face_ratio = _get(signals, "face_detected_ratio")
    if frames < MIN_FRAMES:
        return _unavailable("The answer was too short for reliable body-language analysis.")
    if face_ratio < MIN_FACE_RATIO:
        return _unavailable(
            f"Your face was visible for only {round(face_ratio * 100)}% of the answer, "
            "so body language was not scored. Check lighting and camera position."
        )

    eye = _clamp(_get(signals, "eye_contact_pct"))
    posture = _clamp(_get(signals, "posture_good_ratio") * 100)

    stress = _clamp(_get(signals, "avg_stress"), 0.0, 1.0)
    blink_rate = _get(signals, "blink_rate_per_min")
    if 8 <= blink_rate <= 30:
        blink_part = 100.0
    elif blink_rate < 8:
        blink_part = max(40.0, 100.0 - (8 - blink_rate) * 8)
    else:
        blink_part = max(40.0, 100.0 - (blink_rate - 30) * 3)
    composure = _clamp(0.5 * (1 - stress) * 100 + 0.5 * blink_part)

    minutes = max(_get(signals, "duration_seconds") / 60.0, 0.25)
    smiles_per_min = _get(signals, "smile_count") / minutes
    expressiveness = _clamp(55 + 22 * smiles_per_min)

    components = {
        "eye_contact": round(eye),
        "posture": round(posture),
        "composure": round(composure),
        "expressiveness": round(expressiveness),
    }
    score = round(
        eye * WEIGHTS["eye_contact"]
        + posture * WEIGHTS["posture"]
        + composure * WEIGHTS["composure"]
        + expressiveness * WEIGHTS["expressiveness"]
    )
    return {
        "available": True,
        "score": int(_clamp(score)),
        "components": components,
        "note": "Scored from webcam signals: head direction, posture, calmness and expression.",
    }