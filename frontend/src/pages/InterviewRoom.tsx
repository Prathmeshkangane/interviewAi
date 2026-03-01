import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic, MicOff, ChevronRight, Activity,
  Brain, Eye, Zap, CheckCircle2, Loader2,
  Target, TrendingUp, AlertCircle, Lightbulb
} from 'lucide-react'
import { useSpeech } from '../hooks/useSpeech'
import { useFaceAnalysis } from '../hooks/useFaceAnalysis'
import { getFeedback } from '../lib/api'
import type { FeedbackResponse, Question } from '../lib/api'
import type { SessionData } from '../App'
import { InterviewerAvatar } from '../components/InterviewerAvatar'
import type { InterviewerAvatarHandle } from '../components/InterviewerAvatar'

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
  const [activeTab, setActiveTab] = useState<'transcript' | 'analysis'>('transcript')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const avatarRef = useRef<InterviewerAvatarHandle>(null)

  const speech = useSpeech()
  const faceAnalysis = useFaceAnalysis(videoRef)
  const emotions = faceAnalysis.emotions

  const questions = session.analysisResult.questions
  const currentQ = questions[qIndex] as Question

  useEffect(() => {
    let active = true
    async function startCam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (e) { console.warn('Webcam unavailable:', e) }
    }
    startCam()
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  // Auto-speak question when it changes or on ready
  useEffect(() => {
    if (phase === 'ready' && currentQ?.question) {
      // Small delay so avatar has time to render
      const t = setTimeout(() => {
        avatarRef.current?.speak(currentQ.question)
      }, 800)
      return () => clearTimeout(t)
    }
  }, [qIndex, phase])

  const startRecording = useCallback(() => {
    avatarRef.current?.stopSpeaking()
    setPhase('recording')
    setActiveTab('transcript')
    speech.reset()
    speech.start()
    faceAnalysis.startAnalysis()
  }, [speech, faceAnalysis])

  const stopAndAnalyze = useCallback(async () => {
    speech.stop()
    faceAnalysis.stopAnalysis()

    // Must have at least 10 words to analyze
    const wordCount = speech.transcript.trim().split(/\s+/).filter(Boolean).length
    if (wordCount < 10) {
      setError('Please speak at least a few sentences before stopping.')
      setPhase('recording')
      speech.start()
      faceAnalysis.startAnalysis()
      return
    }

    setPhase('analyzing')
    setError(null)
    const timeline = faceAnalysis.getTimeline()
    try {
      const feedback = await getFeedback(
        currentQ.question,
        speech.transcript || '(no response recorded)',
        timeline,
        session.jobDescription,
        speech.durationSeconds
      )
      setCurrentFeedback(feedback)
      setPhase('reviewed')
      setActiveTab('analysis')
    } catch (err: any) {
      setError(err.message)
      setPhase('recording')
    }
  }, [speech, faceAnalysis, currentQ, session.jobDescription])

  const nextQuestion = useCallback(() => {
    if (!currentFeedback) return
    const answer = { questionIndex: qIndex, transcript: speech.transcript, feedback: currentFeedback }
    const newAnswers = [...completedAnswers, answer]
    setCompletedAnswers(newAnswers)
    if (qIndex + 1 >= questions.length) {
      onComplete(newAnswers, faceAnalysis.getEmotionSummary())
    } else {
      setQIndex(i => i + 1)
      setPhase('ready')
      setCurrentFeedback(null)
      setActiveTab('transcript')
      speech.reset()
    }
  }, [currentFeedback, qIndex, speech, completedAnswers, questions.length, faceAnalysis, onComplete])

  const pct = ((qIndex + (phase === 'reviewed' ? 1 : 0)) / questions.length) * 100
  const classification = currentQ?.classification

  return (
    <div className="min-h-screen flex flex-col p-4 gap-4">

      {/* Top bar */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between glass rounded-2xl px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #7c3aed)' }}>
            <Brain size={16} className="text-white" />
          </div>
          <span className="font-display font-bold text-white text-sm">InterviewAI</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white/40 text-xs font-display hidden md:block">
            {session.candidateName} · {session.jobTitle}
          </span>
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <motion.div className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #00d4ff, #7c3aed)' }}
                animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
            </div>
            <span className="text-white/50 text-xs font-mono">{qIndex + 1}/{questions.length}</span>
          </div>
        </div>
      </motion.div>

      {/* Question Type Tip Banner */}
      <AnimatePresence>
        {classification && phase === 'ready' && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="glass rounded-2xl p-4 border"
            style={{ borderColor: categoryColor(classification.category) + '40' }}
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl"
                style={{ background: categoryColor(classification.category) + '20' }}>
                {categoryEmoji(classification.category)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-display font-bold text-sm"
                    style={{ color: categoryColor(classification.category) }}>
                    {classification.category} Question
                  </span>
                  <span className="text-white/30 text-xs">
                    {classification.confidence}% confident
                  </span>
                  <span className="text-white/30 text-xs ml-auto">⏱ {classification.duration}</span>
                </div>
                <p className="text-white/80 text-sm font-display font-semibold mb-2">
                  💡 {classification.tip}
                </p>
                <div className="flex flex-wrap gap-2">
                  {classification.details.map((d, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-lg font-body text-white/50"
                      style={{ background: 'rgba(255,255,255,0.05)' }}>
                      {i + 1}. {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main split */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* LEFT — Interviewer Avatar + PiP webcam */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }} className="glass rounded-2xl overflow-hidden flex flex-col">

          {/* Interviewer Avatar */}
          <div className="p-4 pb-2">
            <InterviewerAvatar
              ref={avatarRef}
              questionText={currentQ?.question ?? ''}
              questionNumber={qIndex + 1}
              totalQuestions={questions.length}
              phase={phase}
            />
          </div>

          {/* Candidate PiP webcam */}
          <div className="px-4 pb-2">
            <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
              <video ref={videoRef} autoPlay muted playsInline
                className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
              <AnimatePresence>
                {phase === 'recording' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full"
                    style={{ background: 'rgba(255,61,113,0.85)' }}>
                    <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }}
                      className="w-1.5 h-1.5 rounded-full bg-white" />
                    <span className="text-white text-xs font-display font-bold">REC</span>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-xs font-display text-white/60"
                style={{ background: 'rgba(0,0,0,0.6)' }}>You</div>
              <AnimatePresence>
                {phase === 'recording' && speech.wpm > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="absolute bottom-2 right-2 glass-bright rounded-lg px-2 py-1 text-center">
                    <div className="font-mono text-sm font-bold text-white">{speech.wpm}</div>
                    <div className="text-white/40 text-xs leading-none">WPM</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Alert */}
          <AnimatePresence>
            {emotions.alert && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mx-4 mb-2 rounded-xl px-3 py-2 text-xs font-display font-semibold text-white text-center"
                style={{ background: 'rgba(255,61,113,0.85)', boxShadow: '0 0 16px rgba(255,61,113,0.4)' }}>
                {emotions.alert}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Emotion bars */}
          <div className="p-4 pt-1 space-y-2">
            <span className="text-white/30 text-xs font-display uppercase tracking-widest">Your Emotions</span>
            <EmotionBar label="Confidence" value={emotions.confidence} color="#00ff88" icon={<Zap size={11} />} />
            <EmotionBar label="Stress" value={emotions.stress} color="#ff3d71" icon={<Activity size={11} />} />
            <EmotionBar label="Neutral" value={emotions.neutral} color="#00d4ff" icon={<Eye size={11} />} />
            <div className="text-xs font-body text-center rounded-lg py-1"
              style={{ background: getEmotionInterpretation(emotions).bg, color: getEmotionInterpretation(emotions).color }}>
              {getEmotionInterpretation(emotions).label}
            </div>
            <div className="border-t border-white/6 pt-2 grid grid-cols-3 gap-1.5">
              {[
                { icon: '👁️', val: `${emotions.eyeContactScore}%`, label: 'Eye' },
                { icon: '📐', val: emotions.postureGood ? 'Good' : 'Sit up', label: 'Posture', color: emotions.postureGood ? '#00ff88' : '#ffb300' },
                { icon: '😊', val: String(emotions.smileCount), label: 'Smiles' },
              ].map(({ icon, val, label, color }) => (
                <div key={label} className="text-center glass-bright rounded-lg py-1.5">
                  <div className="text-xs">{icon}</div>
                  <div className="font-mono text-xs font-bold" style={{ color: color || 'white' }}>{val}</div>
                  <div className="text-white/30" style={{ fontSize: '9px' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* RIGHT — Question + Transcript + Analysis */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }} className="glass rounded-2xl flex flex-col overflow-hidden">

          {/* Question */}
          <div className="p-5 border-b border-white/6">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-1 rounded-lg text-xs font-display font-semibold"
                style={{ background: difficultyBg(currentQ?.difficulty), color: difficultyColor(currentQ?.difficulty) }}>
                {currentQ?.difficulty}
              </span>
              <span className="text-white/30 text-xs font-display">{currentQ?.category}</span>
            </div>
            <p className="font-display font-semibold text-white text-base leading-snug">
              {currentQ?.question}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/6">
            {(['transcript', 'analysis'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-xs font-display font-semibold uppercase tracking-widest transition-all ${activeTab === tab
                    ? 'text-accent-cyan border-b-2 border-accent-cyan'
                    : 'text-white/30 hover:text-white/60'
                  }`}>
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">

            {/* TRANSCRIPT TAB */}
            {activeTab === 'transcript' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white/40 text-xs font-display uppercase tracking-widest">Live Transcript</span>
                  {phase === 'recording' && (
                    <div className="flex items-center gap-1.5">
                      <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}
                        className="w-1.5 h-1.5 rounded-full bg-accent-red" />
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
                    {phase === 'recording' ? 'Speak now — transcript appears here...' : 'Press Start when ready.'}
                  </p>
                )}

                {/* Live stats during recording */}
                {phase === 'recording' && speech.wordCount > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {[
                      { label: 'Words', value: speech.wordCount },
                      { label: 'WPM', value: speech.wpm },
                      { label: 'Secs', value: Math.round(speech.durationSeconds) },
                    ].map(({ label, value }) => (
                      <div key={label} className="glass-bright rounded-xl p-2 text-center">
                        <div className="font-mono font-bold text-white text-lg">{value}</div>
                        <div className="text-white/40 text-xs">{label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ANALYSIS TAB */}
            {activeTab === 'analysis' && currentFeedback && (
              <div className="space-y-4">

                {/* Overall score */}
                <div className="flex items-center justify-between glass-bright rounded-xl p-3">
                  <span className="text-white/60 text-sm font-display">Overall Score</span>
                  <ScoreBadge score={currentFeedback.overall_score} size="lg" />
                </div>

                {/* STAR breakdown */}
                {currentFeedback.star && (
                  <div className="glass-bright rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Target size={14} className="text-accent-violet" />
                        <span className="text-white/70 text-xs font-display font-semibold uppercase tracking-widest">STAR Structure</span>
                      </div>
                      <ScoreBadge score={currentFeedback.star.star_score} size="sm" />
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {(['situation', 'task', 'action', 'result'] as const).map(key => (
                        <div key={key} className="text-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-1 text-xs font-bold ${currentFeedback.star!.components_detail[key]
                              ? 'bg-accent-green/20 text-accent-green'
                              : 'bg-white/5 text-white/20'
                            }`}>
                            {currentFeedback.star!.components_detail[key] ? '✓' : '✗'}
                          </div>
                          <div className="text-white/50 text-xs capitalize">{key.slice(0, 3)}</div>
                        </div>
                      ))}
                    </div>
                    {currentFeedback.star.missing.length > 0 && (
                      <p className="text-accent-amber text-xs">
                        Missing: {currentFeedback.star.missing.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {/* Confidence trend */}
                {currentFeedback.trend && (
                  <div className="glass-bright rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={14} className="text-accent-cyan" />
                        <span className="text-white/70 text-xs font-display font-semibold uppercase tracking-widest">Confidence Trend</span>
                      </div>
                    </div>
                    <p className="text-sm font-body mb-3" style={{ color: currentFeedback.trend.trend_color }}>
                      {currentFeedback.trend.trend_label}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Start', score: currentFeedback.trend.beginning_score },
                        { label: 'Middle', score: currentFeedback.trend.middle_score },
                        { label: 'End', score: currentFeedback.trend.end_score },
                      ].map(({ label, score }) => (
                        <div key={label} className="text-center">
                          <div className="font-mono font-bold text-lg"
                            style={{ color: score >= 70 ? '#00ff88' : score >= 50 ? '#ffb300' : '#ff3d71' }}>
                            {score}
                          </div>
                          <div className="text-white/40 text-xs">{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fluency breakdown */}
                {currentFeedback.fluency && (
                  <div className="glass-bright rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Zap size={14} className="text-accent-amber" />
                        <span className="text-white/70 text-xs font-display font-semibold uppercase tracking-widest">Fluency</span>
                      </div>
                      <ScoreBadge score={currentFeedback.fluency.fluency_score} size="sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                      <div className="flex justify-between">
                        <span className="text-white/40">Filler words</span>
                        <span className={currentFeedback.fluency.filler_count > 5 ? 'text-accent-red' : 'text-accent-green'}>
                          {currentFeedback.fluency.filler_count}x
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">WPM</span>
                        <span className="text-white/70">{currentFeedback.fluency.wpm}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Hedging</span>
                        <span className={currentFeedback.fluency.hedge_count > 2 ? 'text-accent-amber' : 'text-white/70'}>
                          {currentFeedback.fluency.hedge_count}x
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Eye contact</span>
                        <span className={emotions.lookAwaySeconds > 5 ? 'text-accent-amber' : 'text-accent-green'}>
                          {emotions.lookAwaySeconds > 0 ? `${emotions.lookAwaySeconds}s away` : 'Good'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Smiles</span>
                        <span className="text-accent-green">{emotions.smileCount}x</span>
                      </div>
                    </div>
                    {Object.keys(currentFeedback.fluency.filler_breakdown).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {Object.entries(currentFeedback.fluency.filler_breakdown).slice(0, 5).map(([word, count]) => (
                          <span key={word} className="text-xs px-2 py-0.5 rounded-full font-mono"
                            style={{ background: 'rgba(255,61,113,0.15)', color: '#ff3d71' }}>
                            "{word}" ×{count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* AI Feedback */}
                <div className="glass-bright rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb size={14} className="text-accent-cyan" />
                    <span className="text-white/70 text-xs font-display font-semibold uppercase tracking-widest">AI Feedback</span>
                  </div>
                  <p className="text-white/70 text-sm font-body leading-relaxed mb-3">
                    {currentFeedback.detailed_feedback}
                  </p>
                  <div className="space-y-1.5">
                    {currentFeedback.strengths.slice(0, 2).map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-accent-green mt-0.5">✓</span>
                        <span className="text-white/60">{s}</span>
                      </div>
                    ))}
                    {currentFeedback.improvements.slice(0, 2).map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-accent-amber mt-0.5">→</span>
                        <span className="text-white/60">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {activeTab === 'analysis' && !currentFeedback && (
              <div className="flex flex-col items-center justify-center h-32 text-white/25">
                <AlertCircle size={24} className="mb-2" />
                <p className="text-sm font-body">Analysis appears after you answer</p>
              </div>
            )}
          </div>

          {/* Engagement meter */}
          <div className="px-4 pb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-white/40 text-xs font-display">Engagement</span>
              <span className="text-white/60 text-xs font-mono">
                {emotions.engagementScore}%
              </span>
            </div>
            <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
              <motion.div className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #7c3aed, #00ff88)' }}
                animate={{ width: `${emotions.engagementScore}%` }}
                transition={{ duration: 0.5 }} />
            </div>
          </div>

          {/* Controls */}
          <div className="p-4 pt-2 flex gap-3">
            {phase === 'ready' && (
              <button onClick={startRecording} className="btn-primary flex-1 flex items-center justify-center gap-2 text-white">
                <Mic size={16} />Start Recording
              </button>
            )}
            {phase === 'recording' && (
              <button onClick={stopAndAnalyze}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-display font-semibold text-sm text-white transition-all"
                style={{ background: 'rgba(255,61,113,0.2)', border: '1px solid rgba(255,61,113,0.4)' }}>
                <MicOff size={16} />Stop & Analyze
              </button>
            )}
            {phase === 'analyzing' && (
              <button disabled className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-display font-semibold text-sm text-white/50"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <Loader2 size={16} className="animate-spin" />Analyzing...
              </button>
            )}
            {phase === 'reviewed' && (
              <button onClick={nextQuestion} className="btn-primary flex-1 flex items-center justify-center gap-2 text-white">
                {qIndex + 1 >= questions.length
                  ? <><CheckCircle2 size={16} />View Full Report</>
                  : <>Next Question<ChevronRight size={16} /></>
                }
              </button>
            )}
          </div>
          {error && <p className="px-4 pb-3 text-accent-red text-xs font-body">{error}</p>}
        </motion.div>
      </div>
    </div>
  )
}

// ── Helper components ──────────────────────────────────────────────────────────

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
        <motion.div className="h-full rounded-full" style={{ background: color }}
          animate={{ width: `${value * 100}%` }} transition={{ duration: 0.4 }} />
      </div>
    </div>
  )
}

function ScoreBadge({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const color = score >= 75 ? '#00ff88' : score >= 50 ? '#ffb300' : '#ff3d71'
  return (
    <div className={`font-mono font-bold ${size === 'lg' ? 'text-2xl' : 'text-base'}`} style={{ color }}>
      {score}<span className="text-xs font-normal text-white/30">/100</span>
    </div>
  )
}

function getEmotionInterpretation(e: { stress: number; confidence: number; neutral: number }) {
  if (e.stress > 0.5) return { label: '😰 High stress — take a breath', color: '#ff3d71', bg: 'rgba(255,61,113,0.1)' }
  if (e.confidence > 0.65) return { label: '💪 Strong confident presence', color: '#00ff88', bg: 'rgba(0,255,136,0.1)' }
  if (e.confidence > 0.45) return { label: '🙂 Calm and composed', color: '#00d4ff', bg: 'rgba(0,212,255,0.1)' }
  if (e.stress > 0.3) return { label: '😤 Slight nervousness', color: '#ffb300', bg: 'rgba(255,179,0,0.1)' }
  return { label: '😐 Neutral expression', color: '#ffffff60', bg: 'rgba(255,255,255,0.05)' }
}

function categoryColor(cat: string): string {
  const map: Record<string, string> = {
    'Behavioral': '#00d4ff',
    'Technical': '#7c3aed',
    'Situational': '#ffb300',
    'Competency': '#00ff88',
    'Culture Fit': '#ff3d71',
  }
  return map[cat] ?? '#ffffff'
}

function categoryEmoji(cat: string): string {
  const map: Record<string, string> = {
    'Behavioral': '🎯',
    'Technical': '⚙️',
    'Situational': '🧭',
    'Competency': '💡',
    'Culture Fit': '🤝',
  }
  return map[cat] ?? '❓'
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