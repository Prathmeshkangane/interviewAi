import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { History } from 'lucide-react'
import { UploadScreen } from './pages/UploadScreen'
import { PreviewScreen } from './pages/PreviewScreen'
import { InterviewRoom } from './pages/InterviewRoom'
import { PerformanceReport } from './pages/PerformanceReport'
import { SessionHistory } from './pages/SessionHistory'
import { buildRecord, saveSession } from './lib/history'
import { EMPTY_EMOTION_SUMMARY } from './hooks/useFaceAnalysis'
import type { SessionEmotionSummary } from './hooks/useFaceAnalysis'
import type { AnalyzeDocsResponse, FeedbackResponse } from './lib/api'

export type AppScreen = 'upload' | 'preview' | 'interview' | 'report' | 'history'

export interface CompletedAnswer {
  questionIndex: number
  question: string        // stored with the answer: follow-up questions are not in the original list
  category: string
  transcript: string
  feedback: FeedbackResponse
}

export interface SessionData {
  analysisResult: AnalyzeDocsResponse
  jobDescription: string
  candidateName: string
  jobTitle: string
  completedAnswers: CompletedAnswer[]
  emotionSummary: SessionEmotionSummary
}

const fadeIn = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
  transition: { duration: 0.4 },
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('upload')
  const [historyFrom, setHistoryFrom] = useState<AppScreen>('upload')
  const [session, setSession] = useState<SessionData | null>(null)

  const openHistory = () => {
    setHistoryFrom(screen === 'history' ? 'upload' : screen)
    setScreen('history')
  }
  // If the session was cleared while the history screen was open, fall back to upload
  const closeHistory = () => setScreen(historyFrom !== 'upload' && !session ? 'upload' : historyFrom)

  return (
    <div className="min-h-screen bg-void bg-cyber-grid">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #00d4ff 0%, transparent 70%)' }} />
        <div className="absolute top-1/3 -right-32 w-80 h-80 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
        <div className="absolute -bottom-20 left-1/3 w-72 h-72 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #00ff88 0%, transparent 70%)' }} />
      </div>

      {screen === 'upload' && (
        <button onClick={openHistory} className="btn-ghost fixed top-4 right-4 z-20 flex items-center gap-2 text-sm">
          <History size={14} />
          History
        </button>
      )}

      <AnimatePresence mode="wait">
        {screen === 'upload' && (
          <motion.div key="upload" {...fadeIn}>
            <UploadScreen
              onComplete={(data, name, title, jd) => {
                setSession({
                  analysisResult: data,
                  jobDescription: jd,
                  candidateName: name,
                  jobTitle: title,
                  completedAnswers: [],
                  emotionSummary: EMPTY_EMOTION_SUMMARY,
                })
                setScreen('preview')
              }}
            />
          </motion.div>
        )}

        {screen === 'preview' && session && (
          <motion.div key="preview" {...fadeIn}>
            <PreviewScreen session={session} onStartInterview={() => setScreen('interview')} />
          </motion.div>
        )}

        {screen === 'interview' && session && (
          <motion.div key="interview" {...fadeIn}>
            <InterviewRoom
              session={session}
              onComplete={(answers, emotionSummary) => {
                // Event handler (not an effect), so the session is saved exactly once
                saveSession(buildRecord({
                  answers, emotionSummary,
                  candidateName: session.candidateName, jobTitle: session.jobTitle,
                }))
                setSession(s => (s ? { ...s, completedAnswers: answers, emotionSummary } : s))
                setScreen('report')
              }}
            />
          </motion.div>
        )}

        {screen === 'report' && session && (
          <motion.div key="report" {...fadeIn}>
            <PerformanceReport
              session={session}
              onRestart={() => { setSession(null); setScreen('upload') }}
              onShowHistory={openHistory}
            />
          </motion.div>
        )}

        {screen === 'history' && (
          <motion.div key="history" {...fadeIn}>
            <SessionHistory onBack={closeHistory} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}