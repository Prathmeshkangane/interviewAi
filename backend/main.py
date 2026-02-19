"""
InterviewAI - FastAPI Backend
Endpoints: /analyze-docs, /get-feedback, /generate-report
"""

import os
import json
import tempfile
import base64
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
import uvicorn

from dotenv import load_dotenv
load_dotenv()

# ─── Google Gemini ─────────────────────────────────────────────────────────────
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

# ─── MarkItDown ────────────────────────────────────────────────────────────────
from markitdown import MarkItDown
md_converter = MarkItDown()

# ─── FPDF2 ─────────────────────────────────────────────────────────────────────
from fpdf import FPDF

# ─── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="InterviewAI API",
    description="AI-powered interview analysis platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class EmotionSnapshot(BaseModel):
    timestamp: float
    stress: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    neutral: float = Field(ge=0, le=1)

class FeedbackRequest(BaseModel):
    question: str
    transcript: str
    emotion_timeline: list[EmotionSnapshot]
    job_description: Optional[str] = None

class FeedbackResponse(BaseModel):
    overall_score: int = Field(ge=0, le=100)
    clarity_score: int = Field(ge=0, le=100)
    technical_score: int = Field(ge=0, le=100)
    body_language_score: int = Field(ge=0, le=100)
    confidence_score: int = Field(ge=0, le=100)
    communication_score: int = Field(ge=0, le=100)
    strengths: list[str]
    improvements: list[str]
    detailed_feedback: str
    wpm_assessment: str

class ReportRequest(BaseModel):
    candidate_name: str
    job_title: str
    questions: list[str]
    transcripts: list[str]
    feedbacks: list[FeedbackResponse]
    overall_session_score: int
    emotion_summary: dict

# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "online", "timestamp": datetime.utcnow().isoformat()}


@app.post("/analyze-docs")
async def analyze_docs(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
):
    """
    Convert uploaded PDF resume → Markdown via MarkItDown,
    then use Gemini 2.5 Flash to generate 5 tailored interview questions.
    """
    if not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF resumes are supported.")

    # Save uploaded file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        content = await resume.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Convert PDF → Markdown
        result = md_converter.convert(tmp_path)
        resume_markdown = result.text_content
    except Exception as e:
        raise HTTPException(500, f"Failed to parse resume: {str(e)}")
    finally:
        os.unlink(tmp_path)

    # Generate questions with Gemini
    prompt = f"""You are an expert technical interviewer. Analyze the candidate's resume and the job description, then generate exactly 5 highly tailored behavioral and technical interview questions.

## Candidate Resume (Markdown):
{resume_markdown[:6000]}

## Job Description:
{job_description[:2000]}

Return a JSON object with this exact structure:
{{
  "questions": [
    {{
      "id": 1,
      "question": "...",
      "category": "Technical|Behavioral|Situational|Leadership|Cultural",
      "difficulty": "Easy|Medium|Hard",
      "what_to_look_for": "Key points the interviewer should listen for"
    }}
  ],
  "candidate_summary": "2-sentence summary of the candidate's background",
  "role_fit_assessment": "1-sentence assessment of candidate-role alignment"
}}"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.7,
            ),
        )
        data = json.loads(response.text)
    except Exception as e:
        raise HTTPException(500, f"Gemini API error: {str(e)}")

    return JSONResponse({
        "success": True,
        "resume_markdown": resume_markdown[:3000],
        **data,
    })


@app.post("/get-feedback", response_model=FeedbackResponse)
async def get_feedback(req: FeedbackRequest):
    """
    Analyze the candidate's transcript + emotion timeline with Gemini JSON mode.
    Returns structured performance scores and actionable feedback.
    """
    # Compute average emotions
    if req.emotion_timeline:
        avg_stress = sum(e.stress for e in req.emotion_timeline) / len(req.emotion_timeline)
        avg_confidence = sum(e.confidence for e in req.emotion_timeline) / len(req.emotion_timeline)
        avg_neutral = sum(e.neutral for e in req.emotion_timeline) / len(req.emotion_timeline)
    else:
        avg_stress, avg_confidence, avg_neutral = 0.3, 0.5, 0.2

    prompt = f"""You are an elite interview coach with 20 years of experience. Analyze this interview response with brutal honesty and precision.

## Interview Question:
{req.question}

## Candidate's Response (Transcript):
{req.transcript}

## Facial Emotion Analysis (averages during response):
- Stress Level: {avg_stress:.0%}
- Confidence Level: {avg_confidence:.0%}
- Neutrality: {avg_neutral:.0%}

{f"## Job Context: {req.job_description}" if req.job_description else ""}

Provide detailed, actionable feedback. Be specific, not generic.

Return ONLY this JSON (no markdown, no extra text):
{{
  "overall_score": <0-100 integer>,
  "clarity_score": <0-100>,
  "technical_score": <0-100>,
  "body_language_score": <0-100 based on emotion data>,
  "confidence_score": <0-100>,
  "communication_score": <0-100>,
  "strengths": ["specific strength 1", "specific strength 2", "specific strength 3"],
  "improvements": ["specific improvement 1", "specific improvement 2", "specific improvement 3"],
  "detailed_feedback": "3-4 sentence comprehensive assessment",
  "wpm_assessment": "Assessment of speaking pace and delivery"
}}"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.4,
            ),
        )
        data = json.loads(response.text)
        return FeedbackResponse(**data)
    except Exception as e:
        raise HTTPException(500, f"Feedback generation failed: {str(e)}")


@app.post("/generate-report")
async def generate_report(req: ReportRequest):
    """
    Generate a professional PDF interview report using fpdf2.
    Returns the PDF file for download.
    """
    pdf = InterviewReportPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # ── Header ──────────────────────────────────────────────────────────────
    pdf.set_fill_color(10, 10, 20)
    pdf.rect(0, 0, 210, 45, "F")

    pdf.set_font("Helvetica", "B", 24)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(15, 10)
    pdf.cell(0, 10, "InterviewAI Performance Report", ln=True)

    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(180, 180, 200)
    pdf.set_xy(15, 22)
    pdf.cell(0, 8, f"Candidate: {req.candidate_name}  |  Role: {req.job_title}", ln=True)
    pdf.set_xy(15, 31)
    pdf.cell(0, 8, f"Date: {datetime.now().strftime('%B %d, %Y')}  |  Questions Answered: {len(req.questions)}", ln=True)

    pdf.set_xy(0, 48)

    # ── Overall Score Banner ─────────────────────────────────────────────────
    score_color = _score_color(req.overall_session_score)
    pdf.set_fill_color(*score_color)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 12, f"  Overall Session Score: {req.overall_session_score}/100", ln=True, fill=True)
    pdf.ln(4)

    # ── Radar Summary ────────────────────────────────────────────────────────
    if req.feedbacks:
        avg = lambda key: int(sum(getattr(f, key) for f in req.feedbacks) / len(req.feedbacks))
        dims = {
            "Clarity": avg("clarity_score"),
            "Technical": avg("technical_score"),
            "Body Language": avg("body_language_score"),
            "Confidence": avg("confidence_score"),
            "Communication": avg("communication_score"),
        }

        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(30, 30, 50)
        pdf.cell(0, 8, "Performance Dimensions", ln=True)
        pdf.ln(2)

        col_w = 85
        for i, (dim, score) in enumerate(dims.items()):
            x = 15 + (i % 2) * (col_w + 10)
            if i % 2 == 0 and i > 0:
                pdf.ln(14)
            pdf.set_xy(x, pdf.get_y())
            bar_color = _score_color(score)
            _draw_score_bar(pdf, dim, score, x, pdf.get_y(), bar_color)
            if i % 2 == 1:
                pdf.ln(14)

    pdf.ln(6)

    # ── Emotion Summary ──────────────────────────────────────────────────────
    if req.emotion_summary:
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(30, 30, 50)
        pdf.cell(0, 8, "Session Emotion Summary", ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(60, 60, 80)
        for k, v in req.emotion_summary.items():
            pdf.cell(0, 6, f"  • Average {k.title()}: {v:.0%}", ln=True)
        pdf.ln(4)

    # ── Per-Question Breakdown ───────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(30, 30, 50)
    pdf.cell(0, 8, "Question-by-Question Breakdown", ln=True)
    pdf.ln(2)

    for i, (q, t, fb) in enumerate(zip(req.questions, req.transcripts, req.feedbacks)):
        pdf.add_page()

        # Question header
        pdf.set_fill_color(245, 247, 255)
        pdf.set_text_color(20, 20, 40)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 10, f"Question {i+1} — Score: {fb.overall_score}/100", ln=True, fill=True)

        pdf.set_font("Helvetica", "I", 10)
        pdf.set_text_color(60, 60, 100)
        pdf.multi_cell(0, 6, q)
        pdf.ln(3)

        # Transcript
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(30, 30, 50)
        pdf.cell(0, 7, "Candidate Response:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 100)
        pdf.multi_cell(0, 5, t[:800] + ("..." if len(t) > 800 else ""))
        pdf.ln(3)

        # Feedback
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(30, 30, 50)
        pdf.cell(0, 7, "AI Feedback:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 100)
        pdf.multi_cell(0, 5, fb.detailed_feedback)
        pdf.ln(2)

        # Strengths
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(20, 120, 60)
        pdf.cell(0, 7, "Strengths:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        for s in fb.strengths:
            pdf.cell(0, 5, f"  ✓ {s}", ln=True)
        pdf.ln(2)

        # Improvements
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(180, 60, 20)
        pdf.cell(0, 7, "Areas for Improvement:", ln=True)
        pdf.set_font("Helvetica", "", 9)
        for imp in fb.improvements:
            pdf.cell(0, 5, f"  → {imp}", ln=True)

    # ── Save ─────────────────────────────────────────────────────────────────
    out_dir = Path(tempfile.gettempdir())
    filename = f"interview_report_{req.candidate_name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    out_path = out_dir / filename

    pdf.output(str(out_path))

    return FileResponse(
        path=str(out_path),
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ─── PDF Helpers ───────────────────────────────────────────────────────────────

class InterviewReportPDF(FPDF):
    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 170)
        self.cell(0, 10, f"InterviewAI Report — Page {self.page_no()} — Confidential", align="C")


def _score_color(score: int) -> tuple[int, int, int]:
    if score >= 75:
        return (34, 197, 94)   # green
    elif score >= 50:
        return (251, 191, 36)  # amber
    else:
        return (239, 68, 68)   # red


def _draw_score_bar(pdf: FPDF, label: str, score: int, x: float, y: float, color: tuple):
    bar_w = 80
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(50, 50, 70)
    pdf.set_xy(x, y)
    pdf.cell(50, 5, f"{label}: {score}/100", ln=False)
    # Background bar
    pdf.set_fill_color(220, 220, 235)
    pdf.set_xy(x, y + 5)
    pdf.cell(bar_w, 3, "", fill=True)
    # Score bar
    pdf.set_fill_color(*color)
    pdf.set_xy(x, y + 5)
    pdf.cell(bar_w * score / 100, 3, "", fill=True)


# ─── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)