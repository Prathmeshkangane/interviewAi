// Merged with the original api.ts: same BASE / VITE_API_URL behaviour, same exports, plus the new
// fields (body signals, key points, follow-ups) used by the updated pages.

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const API_BASE = String(BASE).replace(/\/$/, '')

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EmotionSnapshot {
  timestamp: number
  stress: number      // 0-1
  confidence: number  // 0-1
  neutral: number     // 0-1
}

/** Real webcam signals for ONE answer; the backend turns these into the body-language score. */
export interface BodySignals {
  available: boolean
  frames_analyzed: number
  face_detected_ratio: number   // 0-1
  eye_contact_pct: number       // 0-100, share of face-visible time the head faced the camera
  look_away_seconds: number
  posture_good_ratio: number    // 0-1
  smile_count: number
  blink_rate_per_min: number
  avg_stress: number            // 0-1
  duration_seconds: number
}

export interface Classification {
  category: string
  tip: string
  details: string[]
  duration: string
  confidence?: number | null        // classifier confidence, only when it agrees with the label
  model_category?: string | null    // what the DistilBERT classifier predicted
  model_confidence?: number | null
  model_agrees?: boolean | null
}

/** Backwards-compatible name from the original api.ts. */
export type QuestionClassification = Classification

export interface Question {
  id: number
  question: string
  category: string
  difficulty: string
  what_to_look_for?: string
  classification?: Classification
  is_follow_up?: boolean
}

export interface AnalyzeDocsResponse {
  success: boolean
  resume_markdown: string
  overall_fit_score: number
  resume_score: number
  jd_match_score: number
  experience_score: number
  skills_score: number
  education_score: number
  hiring_recommendation: string
  recommendation_reason: string
  resume_strengths: string[]
  resume_gaps: string[]
  candidate_summary: string
  role_fit_assessment: string
  questions: Question[]
}

export interface StarResult {
  star_score: number
  components_found: number
  components_detail: { situation: boolean; task: boolean; action: boolean; result: boolean }
  present: string[]
  missing: string[]
  has_metrics: boolean
  feedback: string[]
  strengths: string[]
}

export interface TrendResult {
  trend: string
  trend_label: string
  trend_color: string
  beginning_score: number
  middle_score: number
  end_score: number
  feedback: string[]
  strengths: string[]
}

export interface FluencyResult {
  fluency_score: number
  word_count: number
  filler_count: number
  filler_rate_percent: number
  filler_breakdown: Record<string, number>
  filler_note?: string
  hedge_count: number
  confidence_markers: number
  specific_numbers_used: number
  vague_words_used: number
  avg_sentence_length: number
  sentence_metrics_available?: boolean
  wpm: number
  repeated_words: string[]
  issues: string[]
  strengths: string[]
}

export interface BodyLanguageResult {
  available: boolean
  score: number | null
  components: { eye_contact: number; posture: number; composure: number; expressiveness: number } | null
  note: string
}

export interface FeedbackResponse {
  overall_score: number
  clarity_score: number
  technical_score: number
  body_language_score: number | null   // null = camera analysis unavailable (not scored)
  confidence_score: number
  communication_score: number
  strengths: string[]
  improvements: string[]
  detailed_feedback: string
  wpm_assessment: string
  key_points_covered: string[]
  key_points_missed: string[]
  fluency?: FluencyResult | null
  star?: StarResult | null             // null for non-behavioral questions
  trend?: TrendResult | null
  body_language?: BodyLanguageResult | null
}

export interface FeedbackPayload {
  question: string
  transcript: string
  emotion_timeline: EmotionSnapshot[]
  duration_seconds: number
  category?: string
  what_to_look_for?: string
  job_description?: string
  resume_context?: string
  body_signals?: BodySignals
}

export interface FollowUpPayload {
  question: string
  transcript: string
  category?: string
  what_to_look_for?: string
  job_description?: string
  resume_context?: string
}

export interface FollowUpResponse {
  question: string
  difficulty: string
  what_to_look_for: string
  category: string
  classification: Classification
}

export interface ReportPayload {
  candidate_name: string
  job_title: string
  questions: string[]
  transcripts: string[]
  feedbacks: FeedbackResponse[]
  overall_session_score: number
  emotion_summary: Record<string, unknown>
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length) return `Invalid request: ${detail[0]?.msg ?? 'validation error'}`
  } catch {
    /* not JSON */
  }
  return `Request failed (${res.status})`
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new Error(`Cannot reach the server at ${API_BASE}. Is the backend running?`)
  }
  if (!res.ok) throw new Error(await errorMessage(res))
  return res
}

function postJson(path: string, body: unknown): Promise<Response> {
  return send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── API calls ──────────────────────────────────────────────────────────────────

export async function analyzeDocs(resume: File, jobDescription: string): Promise<AnalyzeDocsResponse> {
  const form = new FormData()
  form.append('resume', resume)
  form.append('job_description', jobDescription)
  const res = await send('/analyze-docs', { method: 'POST', body: form })
  return res.json()
}

export async function getFeedback(payload: FeedbackPayload): Promise<FeedbackResponse> {
  const res = await postJson('/get-feedback', payload)
  return res.json()
}

export async function getFollowUp(payload: FollowUpPayload): Promise<FollowUpResponse> {
  const res = await postJson('/follow-up', payload)
  return res.json()
}

export async function generateReport(payload: ReportPayload): Promise<Blob> {
  const res = await postJson('/generate-report', payload)
  return res.blob()
}