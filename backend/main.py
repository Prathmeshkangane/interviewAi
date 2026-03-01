"""
InterviewAI - FastAPI Backend
"""
import os
import json
import random
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional, Any

from huggingface_hub import hf_hub_download, snapshot_download


def ensure_model():
    # Download model weights
    if not os.path.exists("question_classifier.pt"):
        print("Downloading model weights...")
        hf_hub_download(
            repo_id="Prathmesh0001/interview-AI",
            filename="question_classifier.pt",
            local_dir=".",
            token=os.getenv("HF_TOKEN")
        )
        print("Model downloaded!")

    # Download tokenizer files individually
    os.makedirs("question_tokenizer", exist_ok=True)

    if not os.path.exists("question_tokenizer/tokenizer.json"):
        print("Downloading tokenizer.json...")
        hf_hub_download(
            repo_id="Prathmesh0001/interview-AI",
            filename="question_tokenizer/tokenizer.json",
            local_dir=".",
            token=os.getenv("HF_TOKEN")
        )
        print("tokenizer.json downloaded!")

    if not os.path.exists("question_tokenizer/tokenizer_config.json"):
        print("Downloading tokenizer_config.json...")
        hf_hub_download(
            repo_id="Prathmesh0001/interview-AI",
            filename="question_tokenizer/tokenizer_config.json",
            local_dir=".",
            token=os.getenv("HF_TOKEN")
        )
        print("tokenizer_config.json downloaded!")

# ── Now load everything else ───────────────────────────────────────────────────
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
import uvicorn

from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

from markitdown import MarkItDown
md_converter = MarkItDown()

from fpdf import FPDF

# ── Our custom models ──────────────────────────────────────────────────────────
from fluency_analyzer import analyze_fluency
from star_detector import detect_star
from confidence_tracker import track_confidence

# ── Question Classifier (DistilBERT) ──────────────────────────────────────────
import torch
import torch.nn as nn

CLASSIFIER_AVAILABLE = False
q_model = None
q_tokenizer = None

try:
    from transformers import DistilBertTokenizer, DistilBertModel

    class QuestionClassifier(nn.Module):
        def __init__(self, num_classes=5):
            super().__init__()
            self.distilbert = DistilBertModel.from_pretrained("./question_tokenizer")
            self.classifier = nn.Sequential(
                nn.Linear(768, 256), nn.ReLU(), nn.Dropout(0.3),
                nn.Linear(256, 64),  nn.ReLU(), nn.Dropout(0.2),
                nn.Linear(64, 5)
            )
        def forward(self, input_ids, attention_mask):
            out = self.distilbert(input_ids=input_ids, attention_mask=attention_mask)
            return self.classifier(out.last_hidden_state[:, 0, :])

    LABEL_NAMES = ["Behavioral", "Technical", "Situational", "Competency", "Culture Fit"]

    CATEGORY_TIPS = {
        "Behavioral": {
            "tip":      "Use STAR Method — Situation, Task, Action, Result",
            "details":  ["Set the scene briefly", "State your specific responsibility",
                         "Describe the exact steps you took", "Share a measurable outcome"],
            "duration": "90-120 seconds ideal",
        },
        "Technical": {
            "tip":      "Define → Explain → Example → Tradeoffs",
            "details":  ["Define the concept clearly", "Explain how it works",
                         "Give a real example from your experience", "Mention alternatives or tradeoffs"],
            "duration": "60-90 seconds ideal",
        },
        "Situational": {
            "tip":      "Show your decision-making process step by step",
            "details":  ["Acknowledge the situation", "State what you would prioritize",
                         "Walk through your approach", "Mention who you would involve"],
            "duration": "75-100 seconds ideal",
        },
        "Competency": {
            "tip":      "Name the skill → Your method → Example → Impact",
            "details":  ["State your approach clearly", "Give a specific example",
                         "Show measurable impact", "Avoid generic answers"],
            "duration": "45-75 seconds ideal",
        },
        "Culture Fit": {
            "tip":      "Be authentic and research-backed",
            "details":  ["Show you researched the company", "Connect their values to yours",
                         "Be specific about why THIS company", "Show genuine enthusiasm"],
            "duration": "30-60 seconds ideal",
        },
    }

    q_device    = torch.device("cpu")
    q_tokenizer = DistilBertTokenizer.from_pretrained("./question_tokenizer")
    q_model     = QuestionClassifier()
    q_model.load_state_dict(torch.load("question_classifier.pt", map_location=q_device))
    q_model.eval()
    CLASSIFIER_AVAILABLE = True
    print("Question classifier loaded!")
except Exception as e:
    print(f"Question classifier not loaded (will skip): {e}")


def classify_question(question: str) -> Optional[dict]:
    if not CLASSIFIER_AVAILABLE or q_model is None or q_tokenizer is None:
        return None
    try:
        enc = q_tokenizer(question, max_length=128, padding="max_length",
                          truncation=True, return_tensors="pt")
        with torch.no_grad():
            logits = q_model(enc["input_ids"], enc["attention_mask"])
        probs    = torch.softmax(logits, dim=1).numpy()[0]
        pred     = int(probs.argmax())
        category = LABEL_NAMES[pred]
        return {
            "category":   category,
            "confidence": round(float(probs[pred]) * 100, 1),
            **CATEGORY_TIPS[category],
        }
    except Exception as e:
        print(f"Classification error: {e}")
        return None


# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(title="InterviewAI API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic models ────────────────────────────────────────────────────────────
class EmotionSnapshot(BaseModel):
    timestamp: float
    stress:     float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    neutral:    float = Field(ge=0, le=1)

class FeedbackRequest(BaseModel):
    question:         str
    transcript:       str
    emotion_timeline: list[EmotionSnapshot]
    job_description:  Optional[str] = None
    duration_seconds: Optional[float] = 0

class FeedbackResponse(BaseModel):
    overall_score:       int = Field(ge=0, le=100)
    clarity_score:       int = Field(ge=0, le=100)
    technical_score:     int = Field(ge=0, le=100)
    body_language_score: int = Field(ge=0, le=100)
    confidence_score:    int = Field(ge=0, le=100)
    communication_score: int = Field(ge=0, le=100)
    strengths:           list[str]
    improvements:        list[str]
    detailed_feedback:   str
    wpm_assessment:      str
    fluency:             Optional[Any] = None
    star:                Optional[Any] = None
    trend:               Optional[Any] = None

class ReportRequest(BaseModel):
    candidate_name:        str
    job_title:             str
    questions:             list[str]
    transcripts:           list[str]
    feedbacks:             list[FeedbackResponse]
    overall_session_score: int
    emotion_summary:       dict


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "online",
        "timestamp": datetime.utcnow().isoformat(),
        "classifier": CLASSIFIER_AVAILABLE,
        "models": ["fluency_analyzer", "star_detector", "confidence_tracker"]
            + (["question_classifier"] if CLASSIFIER_AVAILABLE else []),
    }


@app.post("/analyze-docs")
async def analyze_docs(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
):
    if not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF resumes are supported.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(await resume.read())
        tmp_path = tmp.name

    try:
        result = md_converter.convert(tmp_path)
        resume_markdown = result.text_content
    except Exception as e:
        raise HTTPException(500, f"Failed to parse resume: {str(e)}")
    finally:
        os.unlink(tmp_path)

    seed      = random.randint(10000, 99999)
    variation = random.choice([
        "Focus on past project failures and lessons learned.",
        "Focus on leadership, ownership, and cross-team collaboration.",
        "Focus on system design, scalability, and architecture decisions.",
        "Focus on problem-solving approach and code quality.",
        "Focus on cultural fit, growth mindset, and learning agility.",
    ])

    prompt = f"""You are a senior hiring manager (session: {seed}).
Generate 5 unique interview questions. Angle: {variation}

Rules:
- Reference SPECIFIC projects, technologies, or experiences from the resume
- Never use generic questions like "Tell me about yourself"
- Mix: 2 Technical, 2 Behavioral, 1 Situational
- Vary difficulty from Easy to Hard

Resume:
{resume_markdown[:5000]}

Job Description:
{job_description[:2000]}

Return ONLY valid JSON:
{{
  "overall_fit_score": <0-100>,
  "resume_score": <0-100>,
  "jd_match_score": <0-100>,
  "experience_score": <0-100>,
  "skills_score": <0-100>,
  "education_score": <0-100>,
  "hiring_recommendation": "Strong Hire|Hire|Maybe|No Hire",
  "recommendation_reason": "1-2 sentence explanation",
  "resume_strengths": ["strength 1", "strength 2", "strength 3"],
  "resume_gaps": ["gap 1", "gap 2", "gap 3"],
  "candidate_summary": "2-sentence background summary",
  "role_fit_assessment": "1-sentence alignment summary",
  "questions": [
    {{
      "id": 1,
      "question": "specific tailored question",
      "category": "Technical|Behavioral|Situational|Leadership|Cultural",
      "difficulty": "Easy|Medium|Hard",
      "what_to_look_for": "what interviewer should listen for"
    }}
  ]
}}"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=1.0,
            ),
        )
        data = json.loads(response.text)
    except Exception as e:
        raise HTTPException(500, f"AI analysis error: {str(e)}")

    for q in data.get("questions", []):
        classification = classify_question(q["question"])
        if classification:
            q["classification"] = classification

    return JSONResponse({
        "success": True,
        "resume_markdown": resume_markdown[:3000],
        **data
    })


@app.post("/get-feedback", response_model=FeedbackResponse)
async def get_feedback(req: FeedbackRequest):

    fluency = analyze_fluency(req.transcript, req.duration_seconds or 0)
    star    = detect_star(req.transcript)
    trend   = track_confidence(
        req.transcript,
        [e.model_dump() for e in req.emotion_timeline],
        req.duration_seconds or 0
    )

    if req.emotion_timeline:
        avg_stress = sum(e.stress     for e in req.emotion_timeline) / len(req.emotion_timeline)
        avg_conf   = sum(e.confidence for e in req.emotion_timeline) / len(req.emotion_timeline)
        avg_neut   = sum(e.neutral    for e in req.emotion_timeline) / len(req.emotion_timeline)
    else:
        avg_stress, avg_conf, avg_neut = 0.3, 0.5, 0.2

    prompt = f"""You are an expert interview coach. Evaluate ONLY the relevance and technical accuracy of this answer.
Fluency, STAR structure, and confidence trend are already analyzed by separate models.

Question: {req.question}
Answer: {req.transcript}
{f"Job Context: {req.job_description}" if req.job_description else ""}

Pre-computed scores (do NOT re-analyze these):
- Fluency score: {fluency['fluency_score']}/100
- STAR structure: {star['star_score']}/100 ({star['components_found']}/4 components)
- Confidence trend: {trend['trend_label']}
- Filler words: {fluency['filler_count']} times
- Emotion: Stress {avg_stress:.0%}, Confidence {avg_conf:.0%}

Your job — evaluate only:
1. Is the answer relevant to the question?
2. Technical depth and accuracy
3. What key concepts were covered or missed?

Return ONLY this JSON:
{{
  "relevance_score": <0-100>,
  "technical_score": <0-100>,
  "body_language_score": <0-100>,
  "detailed_feedback": "2-3 sentences on content relevance and technical depth only",
  "strengths": ["content strength 1", "content strength 2"],
  "improvements": ["content improvement 1", "content improvement 2"]
}}"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3,
            ),
        )
        gemini = json.loads(response.text)
    except Exception as e:
        raise HTTPException(500, f"Feedback failed: {str(e)}")

    overall = int(
        fluency["fluency_score"]      * 0.25 +
        star["star_score"]            * 0.20 +
        gemini["relevance_score"]     * 0.30 +
        gemini["technical_score"]     * 0.25
    )

    all_strengths    = fluency["strengths"]  + star["strengths"]  + trend["strengths"]  + gemini.get("strengths", [])
    all_improvements = fluency["issues"]     + star["feedback"]   + trend["feedback"]   + gemini.get("improvements", [])

    seen = set()
    unique_strengths = []
    for s in all_strengths:
        if s not in seen:
            seen.add(s)
            unique_strengths.append(s)

    seen = set()
    unique_improvements = []
    for s in all_improvements:
        if s not in seen:
            seen.add(s)
            unique_improvements.append(s)

    return FeedbackResponse(
        overall_score=       overall,
        clarity_score=       fluency["fluency_score"],
        technical_score=     gemini["technical_score"],
        body_language_score= gemini["body_language_score"],
        confidence_score=    trend["end_score"],
        communication_score= int((fluency["fluency_score"] + gemini["relevance_score"]) / 2),
        strengths=           unique_strengths[:4],
        improvements=        unique_improvements[:4],
        detailed_feedback=   gemini["detailed_feedback"],
        wpm_assessment=(
            f"Fluency: {fluency['fluency_score']}/100 | "
            f"STAR: {star['star_score']}/100 | "
            f"Trend: {trend['trend_label']} | "
            f"Fillers: {fluency['filler_count']} | "
            f"WPM: {fluency['wpm']}"
        ),
        fluency= fluency,
        star=    star,
        trend=   trend,
    )


@app.post("/generate-report")
async def generate_report(req: ReportRequest):
    pdf = InterviewReportPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Header
    pdf.set_fill_color(10, 10, 20)
    pdf.rect(0, 0, 210, 45, "F")
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(15, 10)
    pdf.cell(0, 10, "InterviewAI Performance Report", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(180, 180, 200)
    pdf.set_xy(15, 23)
    pdf.cell(0, 7, _sanitize(f"Candidate: {req.candidate_name}  |  Role: {req.job_title}"), ln=True)
    pdf.set_xy(15, 31)
    pdf.cell(0, 7, f"Date: {datetime.now().strftime('%B %d, %Y')}  |  Questions: {len(req.questions)}", ln=True)
    pdf.set_xy(0, 48)

    # Overall score
    score_color = _score_color(req.overall_session_score)
    pdf.set_fill_color(*score_color)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 12, f"  Overall Score: {req.overall_session_score}/100", ln=True, fill=True)
    pdf.ln(4)

    # Dimensions
    if req.feedbacks:
        avg = lambda key: int(sum(getattr(f, key) for f in req.feedbacks) / len(req.feedbacks))
        dims = {
            "Fluency":       avg("clarity_score"),
            "Technical":     avg("technical_score"),
            "Body Language": avg("body_language_score"),
            "Confidence":    avg("confidence_score"),
            "Communication": avg("communication_score"),
        }
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(30, 30, 50)
        pdf.cell(0, 8, "Performance Dimensions", ln=True)
        pdf.ln(2)
        for i, (dim, score) in enumerate(dims.items()):
            x = 15 + (i % 2) * 95
            if i % 2 == 0 and i > 0:
                pdf.ln(14)
            _draw_score_bar(pdf, dim, score, x, pdf.get_y(), _score_color(score))
            if i % 2 == 1:
                pdf.ln(14)
    pdf.ln(6)

    # Per-question pages
    for i, (q, t, fb) in enumerate(zip(req.questions, req.transcripts, req.feedbacks)):
        pdf.add_page()

        pdf.set_fill_color(240, 242, 255)
        pdf.set_text_color(20, 20, 40)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 10, _sanitize(f"Q{i+1}: Score {fb.overall_score}/100"), ln=True, fill=True)

        pdf.set_font("Helvetica", "I", 10)
        pdf.set_text_color(60, 60, 100)
        pdf.multi_cell(0, 6, _sanitize(q))
        pdf.ln(2)

        if fb.star:
            star_data  = fb.star if isinstance(fb.star, dict) else {}
            star_score = star_data.get("star_score", 0)
            present    = ", ".join(star_data.get("present", [])) or "None"
            missing    = ", ".join(star_data.get("missing", [])) or "None"
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(80, 40, 160)
            pdf.cell(0, 6, f"STAR Score: {star_score}/100  |  Present: {_sanitize(present)}  |  Missing: {_sanitize(missing)}", ln=True)
            pdf.ln(1)

        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(30, 30, 50)
        pdf.cell(0, 7, "Response:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 100)
        pdf.multi_cell(0, 5, _sanitize(t[:600] + ("..." if len(t) > 600 else "")))
        pdf.ln(2)

        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(30, 30, 50)
        pdf.cell(0, 7, "Feedback:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 100)
        pdf.multi_cell(0, 5, _sanitize(fb.detailed_feedback))
        pdf.ln(2)

        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(20, 120, 60)
        pdf.cell(0, 6, "Strengths:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        for s in fb.strengths:
            pdf.cell(0, 5, _sanitize(f"  + {s}"), ln=True)
        pdf.ln(1)

        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(180, 60, 20)
        pdf.cell(0, 6, "Improvements:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        for imp in fb.improvements:
            pdf.cell(0, 5, _sanitize(f"  -> {imp}"), ln=True)

        if fb.wpm_assessment:
            pdf.ln(2)
            pdf.set_font("Helvetica", "I", 8)
            pdf.set_text_color(120, 120, 140)
            pdf.multi_cell(0, 4, _sanitize(fb.wpm_assessment))

    out_dir  = Path(tempfile.gettempdir())
    filename = f"report_{req.candidate_name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    out_path = out_dir / filename
    pdf.output(str(out_path))
    return FileResponse(path=str(out_path), media_type="application/pdf", filename=filename)


# ── PDF helpers ────────────────────────────────────────────────────────────────

class InterviewReportPDF(FPDF):
    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 170)
        self.cell(0, 10, f"InterviewAI Report - Page {self.page_no()} - Confidential", align="C")


def _sanitize(text: str) -> str:
    replacements = {
        '\u2013': '-', '\u2014': '--', '\u2018': "'", '\u2019': "'",
        '\u201c': '"', '\u201d': '"', '\u2022': '*', '\u2026': '...',
        '\u00e2': '',  '\u20ac': 'EUR', '\u2192': '->', '\u2713': '+', '\u2715': 'x',
    }
    for char, rep in replacements.items():
        text = text.replace(char, rep)
    return text.encode('latin-1', errors='replace').decode('latin-1')


def _score_color(score: int) -> tuple:
    if score >= 75: return (34, 197, 94)
    if score >= 50: return (251, 191, 36)
    return (239, 68, 68)


def _draw_score_bar(pdf, label, score, x, y, color):
    bar_w = 80
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 70)
    pdf.set_xy(x, y)
    pdf.cell(50, 5, f"{label}: {score}/100", ln=False)
    pdf.set_fill_color(220, 220, 235)
    pdf.set_xy(x, y + 5)
    pdf.cell(bar_w, 3, "", fill=True)
    pdf.set_fill_color(*color)
    pdf.set_xy(x, y + 5)
    pdf.cell(max(1, bar_w * score // 100), 3, "", fill=True)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)