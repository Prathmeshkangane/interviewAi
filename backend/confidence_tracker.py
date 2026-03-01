from fluency_analyzer import analyze_fluency


def track_confidence(
    transcript: str,
    emotion_timeline: list,
    duration_seconds: float = 0
) -> dict:
    if not transcript or len(transcript.strip()) < 30:
        return _empty_trend()

    words = transcript.split()
    total = len(words)
    if total < 9:
        return _empty_trend()

    # Split transcript into thirds
    third = total // 3
    parts = {
        "beginning": " ".join(words[:third]),
        "middle":    " ".join(words[third:third * 2]),
        "end":       " ".join(words[third * 2:]),
    }

    seg_duration = duration_seconds / 3 if duration_seconds > 0 else 0
    scores = {}
    for part_name, part_text in parts.items():
        analysis = analyze_fluency(part_text, seg_duration)
        scores[part_name] = {
            "fluency_score":      analysis["fluency_score"],
            "filler_count":       analysis["filler_count"],
            "confidence_markers": analysis["confidence_markers"],
            "hedge_count":        analysis["hedge_count"],
        }

    # Split emotion timeline into thirds
    emotion_scores = {"beginning": {}, "middle": {}, "end": {}}
    if emotion_timeline:
        n = len(emotion_timeline)
        t = n // 3

        def avg_emotions(segment):
            if not segment:
                return {"stress": 0.3, "confidence": 0.5, "neutral": 0.4}
            return {
                "stress":     sum(e.get("stress", 0.3)     for e in segment) / len(segment),
                "confidence": sum(e.get("confidence", 0.5) for e in segment) / len(segment),
                "neutral":    sum(e.get("neutral", 0.4)    for e in segment) / len(segment),
            }

        emotion_scores["beginning"] = avg_emotions(emotion_timeline[:t])
        emotion_scores["middle"]    = avg_emotions(emotion_timeline[t:t * 2])
        emotion_scores["end"]       = avg_emotions(emotion_timeline[t * 2:])

    def combined_score(part: str) -> int:
        fluency   = scores[part]["fluency_score"]
        emo_conf  = emotion_scores.get(part, {}).get("confidence", 0.5)
        return int(fluency * 0.6 + emo_conf * 100 * 0.4)

    beginning_score = combined_score("beginning")
    middle_score    = combined_score("middle")
    end_score       = combined_score("end")

    diff = end_score - beginning_score

    if diff >= 15:
        trend       = "strongly_improving"
        trend_label = "Strongly Improving — you build confidence as you speak"
        trend_color = "#00ff88"
    elif diff >= 5:
        trend       = "improving"
        trend_label = "Improving — good momentum through your answer"
        trend_color = "#00d4ff"
    elif diff >= -5:
        trend       = "stable"
        trend_label = "Consistent — steady confidence throughout"
        trend_color = "#ffb300"
    elif diff >= -15:
        trend       = "declining"
        trend_label = "Trailing off — strong start but lost momentum"
        trend_color = "#ff8c00"
    else:
        trend       = "strongly_declining"
        trend_label = "Significant drop — confidence fell towards the end"
        trend_color = "#ff3d71"

    feedback  = []
    strengths = []

    if beginning_score < 50:
        feedback.append("Nervous start — try pausing and breathing before answering")
    elif beginning_score >= 70:
        strengths.append("Strong confident opening")

    if middle_score < beginning_score - 10:
        feedback.append("Lost momentum in the middle — practice smooth transitions")

    if end_score >= 75:
        strengths.append("Finished strongly — great closing impact")
    elif end_score < 50:
        feedback.append("Weak ending — conclude with a clear result statement")

    if scores["beginning"]["filler_count"] > scores["end"]["filler_count"]:
        strengths.append("Filler words decreased as you spoke — good self-correction")
    elif scores["end"]["filler_count"] > scores["beginning"]["filler_count"] + 2:
        feedback.append("Filler words increased towards end — try not to rush")

    return {
        "trend":            trend,
        "trend_label":      trend_label,
        "trend_color":      trend_color,
        "beginning_score":  beginning_score,
        "middle_score":     middle_score,
        "end_score":        end_score,
        "segment_details":  scores,
        "emotion_segments": emotion_scores,
        "feedback":         feedback,
        "strengths":        strengths,
    }


def _empty_trend():
    return {
        "trend":            "unknown",
        "trend_label":      "Not enough speech to analyze trend",
        "trend_color":      "#ffffff40",
        "beginning_score":  0,
        "middle_score":     0,
        "end_score":        0,
        "segment_details":  {},
        "emotion_segments": {},
        "feedback":         ["Answer too short for trend analysis"],
        "strengths":        [],
    }