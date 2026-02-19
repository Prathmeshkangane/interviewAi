import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { UploadScreen } from './pages/UploadScreen'
import { InterviewRoom } from './pages/InterviewRoom'
import { PerformanceReport } from './pages/PerformanceReport'
import type { AnalyzeDocsResponse, FeedbackResponse } from './lib/api'

export type AppScreen = 'upload' | 'interview' | 'report'

export interface SessionData {
  analysisResult: AnalyzeDocsResponse
  jobDescription: string
  candidateName: string
  jobTitle: string
  completedAnswers: {
    questionIndex: number
    transcript: string
    feedback: FeedbackResponse
  }[]
  emotionSummary: Record<string, number>
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('upload')
  const [session, setSession] = useState<SessionData | null>(null)

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

      <AnimatePresence mode="wait">
        {screen === 'upload' && (
          <motion.div key="upload"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5 }}
          >
            <UploadScreen
              onComplete={(data, name, title, jd) => {
                setSession({
                  analysisResult: data,
                  jobDescription: jd,
                  candidateName: name,
                  jobTitle: title,
                  completedAnswers: [],
                  emotionSummary: {},
                })
                setScreen('interview')
              }}
            />
          </motion.div>
        )}

        {screen === 'interview' && session && (
          <motion.div key="interview"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5 }}
          >
            <InterviewRoom
              session={session}
              onComplete={(answers, emotionSummary) => {
                setSession(s => s ? { ...s, completedAnswers: answers, emotionSummary } : s)
                setScreen('report')
              }}
            />
          </motion.div>
        )}

        {screen === 'report' && session && (
          <motion.div key="report"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5 }}
          >
            <PerformanceReport
              session={session}
              onRestart={() => {
                setSession(null)
                setScreen('upload')
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}