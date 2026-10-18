import re
from collections import Counter

import spacy

nlp = spacy.load("en_core_web_sm")

# ── Filler detection ──────────────────────────────────────────────────────────
# Chrome's speech-to-text (Web Speech API) usually deletes "um"/"uh" before the
# transcript reaches us, so these counts can be UNDERSTATED. Ordinary words that are
# only sometimes fillers ("so", "like", "well", "right", "okay") are deliberately NOT
# counted: flagging them penalised perfectly normal speech.
HARD_FILLERS = {"um", "umm", "uh", "uhh", "uhm", "er", "erm", "hmm"}

FILLER_PHRASES = {
    # not counted when part of a real clause: "do you know", "if you know", "as you know"
    "you know": re.compile(r"(?<!\bdo )(?<!\bif )(?<!\bas )\byou know\b"),
    "i mean": re.compile(r"\bi mean\b"),
}

# Real words that become fillers only when over-used (3+ times in one answer)
SOFT_FILLERS = {"basically", "literally", "actually"}
SOFT_FILLER_MIN = 3

FILLER_NOTE = (
    "Browser speech-to-text often removes 'um'/'uh', so filler counts can be understated."
)

HEDGE_PHRASES = [
    "i think", "i guess", "i believe", "maybe",
    "probably", "possibly", "might be", "could be",
    "i'm not sure", "i suppose", "somewhat",
    "a little bit", "more or less",
]

WEAK_OPENERS = [
    "so basically", "um so", "like i said",
    "you know what", "to be honest",
    "i mean like", "well basically",
]

CONFIDENCE_MARKERS = [
    "i led", "i built", "i designed", "i created",
    "i achieved", "i improved", "i managed", "i developed",
    "i implemented", "i increased", "i reduced", "i delivered",
    "we launched", "i owned", "i drove",
]

VAGUE_QUANTIFIERS = [
    "many", "some", "a lot", "lots", "several",
    "various", "multiple", "few", "bunch", "tons",
    "stuff", "things", "something", "somehow",
]

# A number that carries a unit (40%, 3x, 2000 users, 5 hours, $200 ...), not just any digit
QUANTITY_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s?(?:%|percent\b|x\b|times\b|hours?\b|days?\b|weeks?\b|months?\b|"
    r"years?\b|minutes?\b|seconds?\b|people\b|users?\b|customers?\b|requests?\b|ms\b|k\b)"
    r"|[$₹€£]\s?\d+",
    re.IGNORECASE,
)

MIN_WORDS_FULL_ANSWER = 40


def _punctuation_reliable(transcript: str, word_count: int) -> bool:
    """Chrome's recognizer usually returns NO punctuation, which makes spaCy's sentence
    splitting meaningless. Only trust sentence metrics when the transcript clearly has
    sentence-ending punctuation."""
    enders = len(re.findall(r"[.!?]", transcript))
    return word_count >= 15 and enders >= max(2, word_count // 40)


def analyze_fluency(transcript: str, duration_seconds: float = 0, *, whole_answer: bool = True) -> dict:
    """whole_answer=False is used for thirds of an answer (confidence trend): length-based
    feedback only makes sense for a full answer."""
    if not transcript or len(transcript.strip()) < 10:
        return _empty_result()

    text_lower = transcript.lower()
    doc = nlp(transcript)

    words = [t.text.lower() for t in doc if not t.is_punct and not t.is_space]
    word_count = len(words)
    if word_count == 0:
        return _empty_result()
    word_freq_raw = Counter(words)

    punct_ok = _punctuation_reliable(transcript, word_count)
    sentences = list(doc.sents) if punct_ok else []
    sent_lengths = [len(s.text.split()) for s in sentences]
    sentence_count = max(len(sentences), 1)

    # Filler words
    filler_counts: dict[str, int] = {}
    for w in HARD_FILLERS:
        if word_freq_raw[w]:
            filler_counts[w] = word_freq_raw[w]
    for name, rx in FILLER_PHRASES.items():
        c = len(rx.findall(text_lower))
        if c:
            filler_counts[name] = c
    for w in SOFT_FILLERS:
        if word_freq_raw[w] >= SOFT_FILLER_MIN:
            filler_counts[w] = word_freq_raw[w]

    total_fillers = sum(filler_counts.values())
    filler_rate = total_fillers / word_count * 100

    # Hedging
    hedge_count = sum(text_lower.count(p) for p in HEDGE_PHRASES)
    weak_opener_count = sum(text_lower.count(p) for p in WEAK_OPENERS)

    # Confidence
    confidence_count = sum(text_lower.count(p) for p in CONFIDENCE_MARKERS)
    strong_numbers = len(QUANTITY_RE.findall(transcript))
    vague_count = sum(word_freq_raw[v] for v in VAGUE_QUANTIFIERS if " " not in v)

    # Sentence analysis (only when punctuation is trustworthy)
    avg_sent_length = (sum(sent_lengths) / sentence_count) if sent_lengths else 0.0
    very_short_sents = sum(1 for n in sent_lengths if n < 5)
    very_long_sents = sum(1 for n in sent_lengths if n > 35)

    # Repetition
    content_words = [
        t.lemma_.lower() for t in doc
        if not t.is_stop and not t.is_punct and not t.is_space and len(t.text) > 3
    ]
    repeated_words = {w: c for w, c in Counter(content_words).items() if c >= 3}

    # WPM
    wpm = 0
    pacing_note = ""
    if duration_seconds > 0:
        wpm = int((word_count / duration_seconds) * 60)
        if wpm < 100:
            pacing_note = "Speaking too slowly — try to be more natural"
        elif wpm > 180:
            pacing_note = "Speaking too fast — slow down for clarity"
        else:
            pacing_note = "Good speaking pace"

    too_short = whole_answer and word_count < MIN_WORDS_FULL_ANSWER

    # Score
    score = 100.0
    score -= min(30, filler_rate * 2)
    score -= min(15, hedge_count * 3)
    score -= min(10, weak_opener_count * 5)
    score -= min(10, vague_count * 2)
    if punct_ok:
        score -= min(10, very_short_sents * 3)
        score -= min(10, very_long_sents * 3)
    if too_short:
        score -= 10
    score -= min(10, len(repeated_words) * 2)
    score += min(10, confidence_count * 3)
    score += min(10, strong_numbers * 2)
    score = max(0, min(100, int(score)))

    # Feedback
    issues: list[str] = []
    strengths: list[str] = []

    # NOTE: no "zero filler words" praise — the transcript may simply not contain them.
    if total_fillers > 5:
        top = sorted(filler_counts.items(), key=lambda x: -x[1])[:3]
        issues.append(
            f"Used filler words {total_fillers} times — most frequent: "
            + ", ".join(f'"{w}" ({c}x)' for w, c in top)
        )
    elif total_fillers > 0:
        issues.append(f"Minor filler words detected ({total_fillers} times)")

    if hedge_count > 2:
        issues.append(f"Hedging language used {hedge_count} times — speak with more conviction")

    if confidence_count >= 2:
        strengths.append(f"Used {confidence_count} confident action verbs showing ownership")
    elif whole_answer:
        issues.append("Use more action verbs like 'I led', 'I built', 'I achieved'")

    if strong_numbers >= 2:
        strengths.append(f"Backed up points with {strong_numbers} specific numbers/metrics")
    elif vague_count > 3:
        issues.append(f"Used vague quantifiers {vague_count} times — replace with real numbers")

    if punct_ok:
        if avg_sent_length > 30:
            issues.append("Sentences too long — break them up for clarity")
        elif avg_sent_length >= 8:
            strengths.append("Good sentence structure and length")
    if too_short:
        issues.append("Answer is very short — add a concrete example or more detail")

    if repeated_words:
        issues.append(f"Overused words: {', '.join(list(repeated_words)[:3])}")

    if pacing_note:
        (strengths if pacing_note.startswith("Good") else issues).append(pacing_note)

    return {
        "fluency_score": score,
        "word_count": word_count,
        "filler_count": total_fillers,
        "filler_rate_percent": round(filler_rate, 1),
        "filler_breakdown": filler_counts,
        "filler_note": FILLER_NOTE,
        "hedge_count": hedge_count,
        "confidence_markers": confidence_count,
        "specific_numbers_used": strong_numbers,
        "vague_words_used": vague_count,
        "avg_sentence_length": round(avg_sent_length, 1),
        "sentence_metrics_available": punct_ok,
        "wpm": wpm,
        "repeated_words": list(repeated_words)[:5],
        "issues": issues,
        "strengths": strengths,
    }


def _empty_result() -> dict:
    return {
        "fluency_score": 0,
        "word_count": 0,
        "filler_count": 0,
        "filler_rate_percent": 0,
        "filler_breakdown": {},
        "filler_note": FILLER_NOTE,
        "hedge_count": 0,
        "confidence_markers": 0,
        "specific_numbers_used": 0,
        "vague_words_used": 0,
        "avg_sentence_length": 0,
        "sentence_metrics_available": False,
        "wpm": 0,
        "repeated_words": [],
        "issues": ["No transcript detected"],
        "strengths": [],
    }