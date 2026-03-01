const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface QuestionClassification {
  category: string
  confidence: number
  tip: string
  details: string[]
  duration: string
}

export interface Question {
  id: number
  question: string
  category: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  what_to_look_for: string
  classification?: QuestionClassification
}

export interface AnalyzeDocsResponse {
  success: boolean
  questions: Question[]
  candidate_summary: string
  role_fit_assessment: string
  resume_markdown: string
}

export interface EmotionSnapshot {
  timestamp: number
  stress: number
  confidence: number
  neutral: number
}

export interface FeedbackResponse {
  overall_score: number
  clarity_score: number
  technical_score: number
  body_language_score: number
  confidence_score: number
  communication_score: number
  strengths: string[]
  improvements: string[]
  detailed_feedback: string
  wpm_assessment: string
  fluency?: {
    fluency_score: number
    filler_count: number
    filler_rate_percent: number
    filler_breakdown: Record<string, number>
    hedge_count: number
    confidence_markers: number
    specific_numbers_used: number
    wpm: number
    repeated_words: string[]
    issues: string[]
    strengths: string[]
  }
  star?: {
    star_score: number
    components_found: number
    components_detail: {
      situation: boolean
      task: boolean
      action: boolean
      result: boolean
    }
    present: string[]
    missing: string[]
    has_metrics: boolean
    feedback: string[]
    strengths: string[]
  }
  trend?: {
    trend: string
    trend_label: string
    trend_color: string
    beginning_score: number
    middle_score: number
    end_score: number
    feedback: string[]
    strengths: string[]
  }
}

export interface ReportRequest {
  candidate_name: string
  job_title: string
  questions: string[]
  transcripts: string[]
  feedbacks: FeedbackResponse[]
  overall_session_score: number
  emotion_summary: Record<string, number>
}

export async function analyzeDocs(resume: File, jobDescription: string): Promise<AnalyzeDocsResponse> {
  const form = new FormData()
  form.append('resume', resume)
  form.append('job_description', jobDescription)
  const res = await fetch(`${BASE}/analyze-docs`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Server error ${res.status}`)
  }
  return res.json()
}

export async function getFeedback(
  question: string,
  transcript: string,
  emotionTimeline: EmotionSnapshot[],
  jobDescription?: string,
  durationSeconds?: number
): Promise<FeedbackResponse> {
  const res = await fetch(`${BASE}/get-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      transcript,
      emotion_timeline: emotionTimeline,
      job_description: jobDescription,
      duration_seconds: durationSeconds ?? 0,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Server error ${res.status}`)
  }
  return res.json()
}

export async function generateReport(req: ReportRequest): Promise<Blob> {
  const res = await fetch(`${BASE}/generate-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`Report generation failed: ${res.status}`)
  return res.blob()
}