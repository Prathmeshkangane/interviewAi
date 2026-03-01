import re
import spacy

nlp = spacy.load("en_core_web_sm")

SITUATION_MARKERS = [
    "at my previous", "when i was", "in my last",
    "we were facing", "the company was", "our team was",
    "i was working at", "during my time", "a few years ago",
    "last year", "in my role as", "while working on",
    "at that time", "the project was", "we had a situation",
]

TASK_MARKERS = [
    "i was responsible", "my role was", "i needed to",
    "the goal was", "i was asked to", "i had to",
    "my job was", "i was tasked", "it was my responsibility",
    "i was in charge", "i owned", "my objective was",
]

ACTION_MARKERS = [
    "i decided", "i implemented", "i reached out",
    "i built", "i created", "i developed", "i led",
    "i started", "i worked on", "i collaborated",
    "i designed", "i proposed", "i took",
    "i scheduled", "i organized", "i analyzed",
    "first i", "then i", "next i", "i began",
]

RESULT_MARKERS = [
    "as a result", "which led to", "we achieved",
    "this resulted in", "the outcome was", "we reduced",
    "we improved", "we increased", "we saved",
    "ultimately", "in the end", "we successfully",
    "the impact was", "this helped", "we delivered",
]


def detect_star(transcript: str) -> dict:
    if not transcript or len(transcript.strip()) < 20:
        return _empty_star()

    text_lower = transcript.lower()

    situation_found = any(m in text_lower for m in SITUATION_MARKERS)
    task_found      = any(m in text_lower for m in TASK_MARKERS)
    action_found    = any(m in text_lower for m in ACTION_MARKERS)
    result_found    = any(m in text_lower for m in RESULT_MARKERS)

    # Numbers in result are a strong signal
    has_metrics = bool(re.search(
        r'\b\d+[\%x]?\b|\b\d+\s*(percent|times|hours|days|people|users)',
        transcript, re.IGNORECASE
    ))
    if has_metrics:
        result_found = True

    components = {
        "situation": situation_found,
        "task":      task_found,
        "action":    action_found,
        "result":    result_found,
    }
    found_count = sum(components.values())
    score = int((found_count / 4) * 100)

    missing  = [k.upper() for k, v in components.items() if not v]
    present  = [k.upper() for k, v in components.items() if v]

    feedback  = []
    strengths = []

    if not situation_found:
        feedback.append("Missing SITUATION — set the scene with context first")
    if not task_found:
        feedback.append("Missing TASK — clarify your specific responsibility")
    if not action_found:
        feedback.append("Missing ACTION — describe the exact steps you took")
    if not result_found:
        feedback.append("Missing RESULT — state the outcome with numbers if possible")

    if action_found:
        strengths.append("Good use of action verbs showing what you did")
    if result_found and has_metrics:
        strengths.append("Excellent — backed up result with specific metrics")
    elif result_found:
        strengths.append("Result mentioned — try adding specific numbers next time")
    if found_count == 4:
        strengths.append("Complete STAR structure — very well organized answer")

    return {
        "star_score":        score,
        "components_found":  found_count,
        "components_detail": components,
        "present":           present,
        "missing":           missing,
        "has_metrics":       has_metrics,
        "feedback":          feedback,
        "strengths":         strengths,
    }


def _empty_star():
    return {
        "star_score":        0,
        "components_found":  0,
        "components_detail": {"situation": False, "task": False,
                               "action": False, "result": False},
        "present":           [],
        "missing":           ["SITUATION", "TASK", "ACTION", "RESULT"],
        "has_metrics":       False,
        "feedback":          ["No transcript detected"],
        "strengths":         [],
    }