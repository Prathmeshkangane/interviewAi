"""
InterviewAI - FastAPI Backend
"""

import os
import json
import random
import tempfile
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

from google import genai
from google.genai import types
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

from markitdown import MarkItDown
md_converter = MarkItDown()

from fpdf import FPDF

app = FastAPI(title="InterviewAI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/health")
async def health():
    return {"status": "online", "timestamp": datetime.utcnow().isoformat()}

@app.post("/analyze-docs")
async def analyze_docs(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
):
    if not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF resumes are supported.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        content = await resume.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = md_converter.convert(tmp_path)
        resume_markdown = result.text_content
    except Exception as e:
        raise HTTPException(500, f"Failed to parse resume: {str(e)}")
    finally:
        os.unlink(tmp_path)

    seed = random.randint(10000, 99999)
    variation = random.choice([
        "Focus on past project failures and lessons learned.",
        "Focus on leadership, ownership, and cross-team collaboration.",
        "Focus on system design, scalability, and architecture decisions.",
        "Focus on problem-solving approach and code quality.",
        "Focus on cultural fit, growth mindset, and learning agility.",
    ])

    prompt = f"""You are a senior hiring manager at a top tech company (session: {seed}).

PART 1 - Score the resume vs job description like a strict recruiter at Google/Amazon/Meta.

PART 2 - Generate 5 unique questions. Angle: {variation}
Rules: Reference SPECIFIC projects/tech from resume. Never use generic questions. Mix difficulty Easy to Hard.

Resume:
{resume_markdown[:5000]}

Job Description:
{job_description[:2000]}

Return ONLY valid JSON:
{{
  "resume_score": <0-100>,
  "jd_match_score": <0-100>,
  "experience_score": <0-100>,
  "skills_score": <0-100>,
  "education_score": <0-100>,
  "overall_fit_score": <0-100>,
  "resume_strengths": ["strength 1", "strength 2", "strength 3"],
  "resume_gaps": ["gap 1", "gap 2", "gap 3"],
  "hiring_recommendation": "Strong Hire|Hire|Maybe|No Hire",
  "recommendation_reason": "1-2 sentence explanation",
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

    return JSONResponse({"success": True, "resume_markdown": resume_markdown[:3000], **data})


@app.post("/get-feedback", response_model=FeedbackResponse)
async def get_feedback(req: FeedbackRequest):
    if req.emotion_timeline:
        avg_stress = sum(e.stress for e in req.emotion_timeline) / len(req.emotion_timeline)
        avg_confidence = sum(e.confidence for e in req.emotion_timeline) / len(req.emotion_timeline)
        avg_neutral = sum(e.neutral for e in req.emotion_timeline) / len(req.emotion_timeline)
    else:
        avg_stress, avg_confidence, avg_neutral = 0.3, 0.5, 0.2

    prompt = f"""You are an elite interview coach. Analyze this response honestly.

Question: {req.question}
Response: {req.transcript}
Emotion Data: Stress {avg_stress:.0%}, Confidence {avg_confidence:.0%}, Neutral {avg_neutral:.0%}
{f"Job Context: {req.job_description}" if req.job_description else ""}

Return ONLY this JSON:
{{
  "overall_score": <0-100>,
  "clarity_score": <0-100>,
  "technical_score": <0-100>,
  "body_language_score": <0-100>,
  "confidence_score": <0-100>,
  "communication_score": <0-100>,
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "detailed_feedback": "3-4 sentence assessment",
  "wpm_assessment": "speaking pace assessment"
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
        raise HTTPException(500, f"Feedback failed: {str(e)}")


@app.post("/generate-report")
async def generate_report(req: ReportRequest):
    pdf = InterviewReportPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    pdf.set_fill_color(10, 10, 20)
    pdf.rect(0, 0, 210, 45, "F")
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(15, 10)
    pdf.cell(0, 10, "InterviewAI Performance Report", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(180, 180, 200)
    pdf.set_xy(15, 23)
    pdf.cell(0, 7, f"Candidate: {req.candidate_name}  |  Role: {req.job_title}", ln=True)
    pdf.set_xy(15, 31)
    pdf.cell(0, 7, f"Date: {datetime.now().strftime('%B %d, %Y')}  |  Questions: {len(req.questions)}", ln=True)
    pdf.set_xy(0, 48)

    score_color = _score_color(req.overall_session_score)
    pdf.set_fill_color(*score_color)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 12, f"  Overall Score: {req.overall_session_score}/100", ln=True, fill=True)
    pdf.ln(4)

    if req.feedbacks:
        avg = lambda key: int(sum(getattr(f, key) for f in req.feedbacks) / len(req.feedbacks))
        dims = {
            "Clarity": avg("clarity_score"),
            "Technical": avg("technical_score"),
            "Body Language": avg("body_language_score"),
            "Confidence": avg("confidence_score"),
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

    out_dir = Path(tempfile.gettempdir())
    filename = f"report_{req.candidate_name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    out_path = out_dir / filename
    pdf.output(str(out_path))
    return FileResponse(path=str(out_path), media_type="application/pdf", filename=filename)


class InterviewReportPDF(FPDF):
    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 170)
        self.cell(0, 10, f"InterviewAI Report - Page {self.page_no()} - Confidential", align="C")


def _sanitize(text: str) -> str:
    """Replace unicode characters that latin-1 / Helvetica can't handle."""
    replacements = {
        '\u2013': '-',   # en dash
        '\u2014': '--',  # em dash
        '\u2018': "'",   # left single quote
        '\u2019': "'",   # right single quote
        '\u201c': '"',   # left double quote
        '\u201d': '"',   # right double quote
        '\u2022': '*',   # bullet
        '\u2026': '...', # ellipsis
        '\u00e2': '',    # common mojibake
        '\u20ac': 'EUR', # euro sign
        '\u2192': '->',  # right arrow
        '\u2713': '+',   # check mark
        '\u2715': 'x',   # cross mark
    }
    for char, replacement in replacements.items():
        text = text.replace(char, replacement)
    # Final fallback: encode to latin-1 dropping anything still unsupported
    return text.encode('latin-1', errors='replace').decode('latin-1')

def _score_color(score: int) -> tuple:
    if score >= 75: return (34, 197, 94)
    elif score >= 50: return (251, 191, 36)
    else: return (239, 68, 68)

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