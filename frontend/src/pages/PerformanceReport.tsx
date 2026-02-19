import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Cell, Tooltip
} from 'recharts'
import { Download, RotateCcw, CheckCircle2, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react'
import { generateReport } from '../lib/api'
import type { SessionData } from '../App'

interface Props {
  session: SessionData
  onRestart: () => void
}

export function PerformanceReport({ session, onRestart }: Props) {
  const [downloading, setDownloading] = useState(false)

  const { completedAnswers, candidateName, jobTitle, analysisResult } = session
  const questions = analysisResult.questions

  // Aggregate scores
  const avgScore = (key: keyof (typeof completedAnswers)[0]['feedback']) =>
    Math.round(
      completedAnswers.reduce((s, a) => s + ((a.feedback[key] as number) || 0), 0) /
      Math.max(completedAnswers.length, 1)
    )

  const overallScore = avgScore('overall_score')

  const radarData = [
    { subject: 'Clarity', A: avgScore('clarity_score'), fullMark: 100 },
    { subject: 'Technical', A: avgScore('technical_score'), fullMark: 100 },
    { subject: 'Body Lang.', A: avgScore('body_language_score'), fullMark: 100 },
    { subject: 'Confidence', A: avgScore('confidence_score'), fullMark: 100 },
    { subject: 'Comms.', A: avgScore('communication_score'), fullMark: 100 },
  ]

  const barData = completedAnswers.map((a, i) => ({
    name: `Q${i + 1}`,
    score: a.feedback.overall_score,
  }))

  const allStrengths = [...new Set(completedAnswers.flatMap(a => a.feedback.strengths))].slice(0, 5)
  const allImprovements = [...new Set(completedAnswers.flatMap(a => a.feedback.improvements))].slice(0, 5)

  const scoreColor = overallScore >= 75 ? '#00ff88' : overallScore >= 50 ? '#ffb300' : '#ff3d71'

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const blob = await generateReport({
        candidate_name: candidateName,
        job_title: jobTitle,
        questions: questions.map(q => q.question),
        transcripts: completedAnswers.map(a => a.transcript),
        feedbacks: completedAnswers.map(a => a.feedback),
        overall_session_score: overallScore,
        emotion_summary: session.emotionSummary,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `InterviewAI_${candidateName.replace(' ', '_')}_Report.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between mb-8"
      >
        <div>
          <h1 className="font-display text-3xl font-bold text-white mb-1">Performance Report</h1>
          <p className="text-white/40 font-body">
            {candidateName} · {jobTitle} · {completedAnswers.length} questions answered
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onRestart} className="btn-ghost flex items-center gap-2">
            <RotateCcw size={14} />
            Restart
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="btn-primary flex items-center gap-2 text-white"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download PDF
          </button>
        </div>
      </motion.div>

      {/* Score hero + radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Big score */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="glass rounded-2xl p-8 flex flex-col items-center justify-center"
        >
          <div className="relative mb-4">
            <svg width="120" height="120" className="-rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
              <motion.circle
                cx="60" cy="60" r="52" fill="none"
                stroke={scoreColor} strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 52}`}
                initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - overallScore / 100) }}
                transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                style={{ filter: `drop-shadow(0 0 8px ${scoreColor})` }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span
                className="font-display text-4xl font-black"
                style={{ color: scoreColor }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                {overallScore}
              </motion.span>
              <span className="text-white/30 text-sm font-body">/100</span>
            </div>
          </div>
          <h2 className="font-display font-bold text-white text-xl mb-1">Overall Score</h2>
          <p className="text-white/40 text-sm font-body text-center">{getGrade(overallScore)}</p>

          {/* Emotion summary */}
          {Object.keys(session.emotionSummary).length > 0 && (
            <div className="mt-6 w-full space-y-2">
              <p className="text-white/30 text-xs font-display uppercase tracking-widest mb-3">Session Emotions</p>
              {Object.entries(session.emotionSummary).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-white/50 text-xs font-body capitalize">{k}</span>
                  <span className="text-white/70 text-xs font-mono">{(v * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Radar chart */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass rounded-2xl p-6 lg:col-span-2"
        >
          <h3 className="font-display font-semibold text-white mb-4">Performance Dimensions</h3>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'DM Sans' }}
              />
              <Radar
                name="Score"
                dataKey="A"
                stroke="#00d4ff"
                fill="#00d4ff"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Bar chart + strengths/improvements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Per-question scores */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass rounded-2xl p-6"
        >
          <h3 className="font-display font-semibold text-white mb-4">Score per Question</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} barSize={28}>
              <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'rgba(12,14,28,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
                labelStyle={{ color: 'white' }}
                itemStyle={{ color: '#00d4ff' }}
              />
              <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.score >= 75 ? '#00ff88' : entry.score >= 50 ? '#ffb300' : '#ff3d71'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Strengths + Improvements */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="glass rounded-2xl p-6 space-y-4"
        >
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={14} className="text-accent-green" />
              <h3 className="font-display font-semibold text-white text-sm">Key Strengths</h3>
            </div>
            <ul className="space-y-2">
              {allStrengths.map((s, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className="text-white/65 text-sm font-body flex items-start gap-2"
                >
                  <span className="text-accent-green mt-0.5 shrink-0">•</span>
                  {s}
                </motion.li>
              ))}
            </ul>
          </div>
          <div className="border-t border-white/6 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} className="text-accent-amber" />
              <h3 className="font-display font-semibold text-white text-sm">Areas to Improve</h3>
            </div>
            <ul className="space-y-2">
              {allImprovements.map((s, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.05 }}
                  className="text-white/65 text-sm font-body flex items-start gap-2"
                >
                  <span className="text-accent-amber mt-0.5 shrink-0">→</span>
                  {s}
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>

      {/* Q&A breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass rounded-2xl p-6"
      >
        <h3 className="font-display font-semibold text-white mb-5">Question Breakdown</h3>
        <div className="space-y-4">
          {completedAnswers.map((a, i) => {
            const q = questions[a.questionIndex]
            const fb = a.feedback
            const color = fb.overall_score >= 75 ? '#00ff88' : fb.overall_score >= 50 ? '#ffb300' : '#ff3d71'
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 + i * 0.07 }}
                className="glass-bright rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="font-display font-medium text-white/90 text-sm flex-1">
                    <span className="text-white/30 mr-2">Q{i + 1}.</span>
                    {q?.question}
                  </p>
                  <div className="font-mono font-bold text-xl shrink-0" style={{ color }}>
                    {fb.overall_score}
                  </div>
                </div>
                <p className="text-white/50 text-sm font-body leading-relaxed mb-3">{fb.detailed_feedback}</p>
                <p className="text-white/30 text-xs font-mono">{fb.wpm_assessment}</p>
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

function getGrade(score: number): string {
  if (score >= 90) return 'Outstanding — Ready to impress'
  if (score >= 75) return 'Strong — Minor polish needed'
  if (score >= 60) return 'Good — Keep practicing'
  if (score >= 45) return 'Fair — Significant room to grow'
  return 'Needs work — Focus on the basics'
}