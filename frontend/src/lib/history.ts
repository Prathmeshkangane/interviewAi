import type { CompletedAnswer } from '../App'
import type { SessionEmotionSummary } from '../hooks/useFaceAnalysis'

// Session history lives in this browser's localStorage only (nothing is sent to a server).
const KEY = 'interviewai.history.v1'
const MAX_SESSIONS = 50

export interface AverageScores {
  overall: number
  clarity: number
  technical: number
  bodyLanguage: number | null   // null when the camera analysis never produced a score
  confidence: number
  communication: number
}

export interface SessionRecord {
  id: string
  date: string                  // ISO timestamp
  candidateName: string
  jobTitle: string
  scores: AverageScores
  questions: { question: string; category: string; score: number }[]
  emotion: SessionEmotionSummary | null
}

const mean = (values: number[]) =>
  values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0

/** Average each score over the answers. Body language ignores unscored answers (null). */
export function averageScores(answers: CompletedAnswer[]): AverageScores {
  const body = answers
    .map(a => a.feedback.body_language_score)
    .filter((v): v is number => typeof v === 'number')
  return {
    overall: mean(answers.map(a => a.feedback.overall_score)),
    clarity: mean(answers.map(a => a.feedback.clarity_score)),
    technical: mean(answers.map(a => a.feedback.technical_score)),
    bodyLanguage: body.length ? mean(body) : null,
    confidence: mean(answers.map(a => a.feedback.confidence_score)),
    communication: mean(answers.map(a => a.feedback.communication_score)),
  }
}

export function buildRecord(args: {
  answers: CompletedAnswer[]
  emotionSummary: SessionEmotionSummary
  candidateName: string
  jobTitle: string
}): SessionRecord {
  const { answers, emotionSummary, candidateName, jobTitle } = args
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
    date: new Date().toISOString(),
    candidateName,
    jobTitle,
    scores: averageScores(answers),
    questions: answers.map(a => ({ question: a.question, category: a.category, score: a.feedback.overall_score })),
    emotion: emotionSummary.available ? emotionSummary : null,
  }
}

function isRecord(v: unknown): v is SessionRecord {
  const r = v as SessionRecord
  return !!r && typeof r.id === 'string' && typeof r.date === 'string' &&
    !!r.scores && typeof r.scores.overall === 'number' && Array.isArray(r.questions)
}

export function loadHistory(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isRecord) : []
  } catch {
    return []
  }
}

function persist(records: SessionRecord[]): SessionRecord[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(records))
  } catch {
    /* storage blocked or full: history is a convenience, never fatal */
  }
  return records
}

/** Newest first, capped at MAX_SESSIONS. */
export function saveSession(record: SessionRecord): SessionRecord[] {
  return persist([record, ...loadHistory()].slice(0, MAX_SESSIONS))
}

export function deleteSession(id: string): SessionRecord[] {
  return persist(loadHistory().filter(r => r.id !== id))
}

export function clearHistory(): SessionRecord[] {
  return persist([])
}