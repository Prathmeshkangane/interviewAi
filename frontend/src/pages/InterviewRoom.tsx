import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic, MicOff, ChevronRight, Clock, Activity,
  Brain, Eye, Zap, CheckCircle2, Loader2
} from 'lucide-react'
import { useSpeech } from '../hooks/useSpeech'
import { useFaceAnalysis } from '../hooks/useFaceAnalysis'
import { getFeedback } from '../lib/api'
import type { FeedbackResponse } from '../lib/api'
import type { SessionData } from '../App'

interface Props {
  session: SessionData
  onComplete: (answers: SessionData['completedAnswers'], emotionSummary: Record<string, number>) => void
}

export function InterviewRoom({ session, onComplete }: Props) {
  const [qIndex, setQIndex] = useState(0)
  const [phase, setPhase] = useState<'ready' | 'recording' | 'analyzing' | 'reviewed'>('ready')
  const [completedAnswers, setCompletedAnswers] = useState<SessionData['completedAnswers']>([])
  const [currentFeedback, setCurrentFeedback] = useState<FeedbackResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const speech = useSpeech()
  const faceAnalysis = useFaceAnalysis(videoRef)

  const questions = session.analysisResult.questions
  const currentQ = questions[qIndex]

  // Start webcam
  useEffect(() => {
    let active = true
    async function startCam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (e) {
        console.warn('Webcam unavailable:', e)
      }
    }
    startCam()
    return () => {
      active = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const startRecording = useCallback(() => {
    setPhase('recording')
    speech.reset()
    speech.start()
    faceAnalysis.startAnalysis()
  }, [speech, faceAnalysis])

  const stopAndAnalyze = useCallback(async () => {
    speech.stop()
    faceAnalysis.stopAnalysis()
    setPhase('analyzing')
    setError(null)

    const timeline = faceAnalysis.getTimeline()
    try {
      const feedback = await getFeedback(
        currentQ.question,
        speech.transcript || '(no response recorded)',
        timeline,
        session.jobDescription
      )
      setCurrentFeedback(feedback)
      setPhase('reviewed')
    } catch (err: any) {
      setError(err.message)
      setPhase('recording')
    }
  }, [speech, faceAnalysis, currentQ, session.jobDescription])

  const nextQuestion = useCallback(() => {
    if (!currentFeedback) return
    const answer = {
      questionIndex: qIndex,
      transcript: speech.transcript,
      feedback: currentFeedback,
    }
    const newAnswers = [...completedAnswers, answer]
    setCompletedAnswers(newAnswers)

    if (qIndex + 1 >= questions.length) {
      const summary = faceAnalysis.getEmotionSummary()
      onComplete(newAnswers, summary)
    } else {
      setQIndex(i => i + 1)
      setPhase('ready')
      setCurrentFeedback(null)
      speech.reset()
    }
  }, [currentFeedback, qIndex, speech, completedAnswers, questions.length, faceAnalysis, onComplete])

  const pct = ((qIndex + (phase === 'reviewed' ? 1 : 0)) / questions.length) * 100

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-6 gap-4">
      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between glass rounded-2xl px-6 py-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #7c3aed)' }}>
            <Brain size={16} className="text-white" />
          </div>
          <span className="font-display font-bold text-white text-sm">InterviewAI</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-white/40 text-xs font-display">
            {session.candidateName} · {session.jobTitle}
          </span>
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #00d4ff, #7c3aed)' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
            <span className="text-white/50 text-xs font-mono">
              {qIndex + 1}/{questions.length}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Main split view */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Webcam + Emotion Panel */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="glass rounded-2xl overflow-hidden flex flex-col"
        >
          {/* Video */}
          <div className="relative flex-1 bg-black min-h-64">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* AI Analyzing overlay */}
            <AnimatePresence>
              {phase === 'recording' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full"
                  style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.4)' }}
                >
                  <motion.div
                    animate={{ scale: [1, 1.4, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-accent-cyan"
                  />
                  <span className="text-accent-cyan text-xs font-display font-semibold">AI Analyzing</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* WPM badge */}
            <AnimatePresence>
              {phase === 'recording' && speech.wpm > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute top-3 right-3 glass-bright rounded-xl px-3 py-1.5 text-center"
                >
                  <div className="font-mono text-lg font-bold text-white">{speech.wpm}</div>
                  <div className="text-white/40 text-xs">WPM</div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scan line during recording */}
            <AnimatePresence>
              {phase === 'recording' && (
                <motion.div
                  className="absolute inset-x-0 h-0.5 pointer-events-none"
                  style={{ background: 'linear-gradient(90deg, transparent, #00d4ff, transparent)' }}
                  animate={{ top: ['0%', '100%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Emotion bars */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-white/40 text-xs font-display uppercase tracking-widest">Facial Analysis</span>
              {faceAnalysis.emotions.error && (
                <span className="text-accent-amber/60 text-xs">Simulated</span>
              )}
            </div>
            <EmotionBar label="Confidence" value={faceAnalysis.emotions.confidence} color="#00ff88" icon={<Zap size={12} />} />
            <EmotionBar label="Stress" value={faceAnalysis.emotions.stress} color="#ff3d71" icon={<Activity size={12} />} />
            <EmotionBar label="Neutral" value={faceAnalysis.emotions.neutral} color="#00d4ff" icon={<Eye size={12} />} />
          </div>
        </motion.div>

        {/* RIGHT: Question + Transcript */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }}
          className="glass rounded-2xl flex flex-col overflow-hidden"
        >
          {/* Question */}
          <div className="p-6 border-b border-white/6">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2.5 py-1 rounded-lg text-xs font-display font-semibold"
                style={{
                  background: difficultyBg(currentQ?.difficulty),
                  color: difficultyColor(currentQ?.difficulty)
                }}>
                {currentQ?.difficulty}
              </span>
              <span className="text-white/30 text-xs font-display">{currentQ?.category}</span>
            </div>
            <p className="font-display font-semibold text-white text-lg leading-snug">
              {currentQ?.question}
            </p>
          </div>

          {/* Transcript area */}
          <div className="flex-1 p-5 overflow-y-auto min-h-40">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/40 text-xs font-display uppercase tracking-widest">Live Transcript</span>
              {phase === 'recording' && (
                <div className="flex items-center gap-1.5">
                  <motion.div
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-1.5 h-1.5 rounded-full bg-accent-red"
                  />
                  <span className="text-accent-red text-xs font-mono">REC</span>
                </div>
              )}
            </div>

            {speech.transcript ? (
              <p className="font-body text-white/80 leading-relaxed text-sm">
                {speech.transcript}
                {speech.interimTranscript && (
                  <span className="text-white/35 italic">{speech.interimTranscript}</span>
                )}
              </p>
            ) : (
              <p className="text-white/25 text-sm font-body italic">
                {phase === 'recording' ? 'Speak now — your transcript will appear here...' : 'Press Start when ready.'}
              </p>
            )}
          </div>

          {/* Confidence meter */}
          <div className="px-5 pb-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white/40 text-xs font-display">Confidence Meter</span>
              <span className="text-white/60 text-xs font-mono">
                {(faceAnalysis.emotions.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-2 bg-white/8 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #7c3aed, #00ff88)' }}
                animate={{ width: `${faceAnalysis.emotions.confidence * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* Feedback */}
          <AnimatePresence>
            {currentFeedback && phase === 'reviewed' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mx-5 mb-4 glass-bright rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/50 text-xs font-display uppercase tracking-widest">AI Feedback</span>
                  <ScoreBadge score={currentFeedback.overall_score} />
                </div>
                <p className="text-white/70 text-sm font-body leading-relaxed mb-2">
                  {currentFeedback.detailed_feedback}
                </p>
                <div className="flex gap-2 flex-wrap">
                  {currentFeedback.strengths.slice(0, 2).map(s => (
                    <span key={s} className="text-xs px-2.5 py-1 rounded-full font-body"
                      style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.2)' }}>
                      ✓ {s}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Controls */}
          <div className="p-5 pt-0 flex gap-3">
            {phase === 'ready' && (
              <button onClick={startRecording} className="btn-primary flex-1 flex items-center justify-center gap-2 text-white">
                <Mic size={16} />
                Start Recording
              </button>
            )}
            {phase === 'recording' && (
              <button onClick={stopAndAnalyze}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-display font-semibold text-sm text-white transition-all"
                style={{ background: 'rgba(255,61,113,0.2)', border: '1px solid rgba(255,61,113,0.4)' }}>
                <MicOff size={16} />
                Stop & Analyze
              </button>
            )}
            {phase === 'analyzing' && (
              <button disabled className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-display font-semibold text-sm text-white/50"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <Loader2 size={16} className="animate-spin" />
                Analyzing with Gemini...
              </button>
            )}
            {phase === 'reviewed' && (
              <button onClick={nextQuestion} className="btn-primary flex-1 flex items-center justify-center gap-2 text-white">
                {qIndex + 1 >= questions.length ? (
                  <><CheckCircle2 size={16} />View Full Report</>
                ) : (
                  <>Next Question<ChevronRight size={16} /></>
                )}
              </button>
            )}
          </div>

          {error && (
            <p className="px-5 pb-3 text-accent-red text-xs font-body">{error}</p>
          )}
        </motion.div>
      </div>
    </div>
  )
}

function EmotionBar({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5" style={{ color }}>
          {icon}
          <span className="text-xs font-display font-medium">{label}</span>
        </div>
        <span className="text-white/40 text-xs font-mono">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 75 ? '#00ff88' : score >= 50 ? '#ffb300' : '#ff3d71'
  return (
    <div className="font-mono font-bold text-lg" style={{ color }}>
      {score}<span className="text-xs font-normal text-white/30">/100</span>
    </div>
  )
}

function difficultyBg(d?: string) {
  if (d === 'Easy') return 'rgba(0,255,136,0.1)'
  if (d === 'Hard') return 'rgba(255,61,113,0.1)'
  return 'rgba(255,179,0,0.1)'
}
function difficultyColor(d?: string) {
  if (d === 'Easy') return '#00ff88'
  if (d === 'Hard') return '#ff3d71'
  return '#ffb300'
}