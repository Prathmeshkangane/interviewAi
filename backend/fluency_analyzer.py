import re
import spacy
from collections import Counter

nlp = spacy.load("en_core_web_sm")

FILLER_WORDS = {
    "um", "uh", "umm", "uhh", "hmm",
    "like", "basically", "literally", "actually",
    "right", "okay", "so", "well",
    "you know", "i mean", "you see",
    "i guess", "kind of", "sort of"
}

HEDGE_PHRASES = [
    "i think", "i guess", "i believe", "maybe",
    "probably", "possibly", "might be", "could be",
    "i'm not sure", "i suppose", "somewhat",
    "a little bit", "more or less"
]

WEAK_OPENERS = [
    "so basically", "um so", "like i said",
    "you know what", "to be honest",
    "i mean like", "well basically"
]

CONFIDENCE_MARKERS = [
    "i led", "i built", "i designed", "i created",
    "i achieved", "i improved", "i managed", "i developed",
    "i implemented", "i increased", "i reduced", "i delivered",
    "we launched", "i owned", "i drove"
]

VAGUE_QUANTIFIERS = [
    "many", "some", "a lot", "lots", "several",
    "various", "multiple", "few", "bunch", "tons",
    "stuff", "things", "something", "somehow"
]

STRONG_QUANTIFIERS = re.compile(
    r'\b\d+[\%x]?\b|\b\d+\s*(percent|times|hours|days|weeks|months|years|people|users|ms)\b',
    re.IGNORECASE
)


def analyze_fluency(transcript: str, duration_seconds: float = 0) -> dict:
    if not transcript or len(transcript.strip()) < 10:
        return _empty_result()

    text_lower = transcript.lower()
    doc = nlp(transcript)

    words = [token.text.lower() for token in doc if not token.is_punct]
    sentences = list(doc.sents)
    word_count = len(words)
    sentence_count = max(len(sentences), 1)

    # Filler words
    filler_counts = {}
    for filler in FILLER_WORDS:
        if " " in filler:
            count = text_lower.count(filler)
        else:
            count = sum(1 for w in words if w == filler)
        if count > 0:
            filler_counts[filler] = count

    total_fillers = sum(filler_counts.values())
    filler_rate = (total_fillers / word_count * 100) if word_count > 0 else 0

    # Hedging
    hedge_count = sum(text_lower.count(p) for p in HEDGE_PHRASES)
    weak_opener_count = sum(text_lower.count(p) for p in WEAK_OPENERS)

    # Confidence
    confidence_count = sum(text_lower.count(p) for p in CONFIDENCE_MARKERS)
    strong_numbers = len(STRONG_QUANTIFIERS.findall(transcript))
    vague_count = sum(
        sum(1 for w in words if w == v)
        for v in VAGUE_QUANTIFIERS if " " not in v
    )

    # Sentence analysis
    sent_lengths = [len(s.text.split()) for s in sentences]
    avg_sent_length = sum(sent_lengths) / sentence_count
    very_short_sents = sum(1 for l in sent_lengths if l < 5)
    very_long_sents = sum(1 for l in sent_lengths if l > 35)

    # Repetition
    content_words = [
        token.lemma_.lower() for token in doc
        if not token.is_stop and not token.is_punct and len(token.text) > 3
    ]
    word_freq = Counter(content_words)
    repeated_words = {w: c for w, c in word_freq.items() if c >= 3}

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

    # Score
    score = 100
    score -= min(30, filler_rate * 2)
    score -= min(15, hedge_count * 3)
    score -= min(10, weak_opener_count * 5)
    score -= min(10, vague_count * 2)
    score -= min(10, very_short_sents * 3)
    score -= min(10, very_long_sents * 3)
    score -= min(10, len(repeated_words) * 2)
    score += min(10, confidence_count * 3)
    score += min(10, strong_numbers * 2)
    score = max(0, min(100, int(score)))

    # Feedback
    issues = []
    strengths = []

    if total_fillers > 5:
        top_fillers = sorted(filler_counts.items(), key=lambda x: -x[1])[:3]
        filler_str = ", ".join(f'"{w}" ({c}x)' for w, c in top_fillers)
        issues.append(f"Used filler words {total_fillers} times — most frequent: {filler_str}")
    elif total_fillers > 0:
        issues.append(f"Minor filler words detected ({total_fillers} times)")
    else:
        strengths.append("Zero filler words — very clean delivery")

    if hedge_count > 2:
        issues.append(f"Hedging language used {hedge_count} times — speak with more conviction")

    if confidence_count >= 2:
        strengths.append(f"Used {confidence_count} confident action verbs showing ownership")
    else:
        issues.append("Use more action verbs like 'I led', 'I built', 'I achieved'")

    if strong_numbers >= 2:
        strengths.append(f"Backed up points with {strong_numbers} specific numbers/metrics")
    elif vague_count > 3:
        issues.append(f"Used vague quantifiers {vague_count} times — replace with real numbers")

    if avg_sent_length > 30:
        issues.append("Sentences too long — break them up for clarity")
    elif avg_sent_length < 8:
        issues.append("Answers too brief — elaborate more on your points")
    else:
        strengths.append("Good sentence structure and length")

    if repeated_words:
        top_repeated = list(repeated_words.keys())[:3]
        issues.append(f"Overused words: {', '.join(top_repeated)}")

    if pacing_note:
        if "Good" in pacing_note:
            strengths.append(pacing_note)
        else:
            issues.append(pacing_note)

    return {
        "fluency_score":          score,
        "word_count":             word_count,
        "filler_count":           total_fillers,
        "filler_rate_percent":    round(filler_rate, 1),
        "filler_breakdown":       filler_counts,
        "hedge_count":            hedge_count,
        "confidence_markers":     confidence_count,
        "specific_numbers_used":  strong_numbers,
        "vague_words_used":       vague_count,
        "avg_sentence_length":    round(avg_sent_length, 1),
        "wpm":                    wpm,
        "repeated_words":         list(repeated_words.keys())[:5],
        "issues":                 issues,
        "strengths":              strengths,
    }


def _empty_result():
    return {
        "fluency_score":          0,
        "word_count":             0,
        "filler_count":           0,
        "filler_rate_percent":    0,
        "filler_breakdown":       {},
        "hedge_count":            0,
        "confidence_markers":     0,
        "specific_numbers_used":  0,
        "vague_words_used":       0,
        "avg_sentence_length":    0,
        "wpm":                    0,
        "repeated_words":         [],
        "issues":                 ["No transcript detected"],
        "strengths":              [],
    }