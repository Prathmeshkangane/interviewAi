import { motion } from 'framer-motion'
import {
  CheckCircle2, AlertTriangle, ArrowRight, Brain,
  Star, TrendingUp, FileText, Briefcase, GraduationCap, Code2
} from 'lucide-react'
import type { SessionData } from '../App'

interface Props {
  session: SessionData
  onStartInterview: () => void
}

export function PreviewScreen({ session, onStartInterview }: Props) {
  const r = session.analysisResult as any

  const fitScore: number = r.overall_fit_score ?? 0
  const recommendation: string = r.hiring_recommendation ?? 'Maybe'

  const recColor = {
    'Strong Hire': '#00ff88',
    'Hire': '#00d4ff',
    'Maybe': '#ffb300',
    'No Hire': '#ff3d71',
  }[recommendation] ?? '#ffb300'

  const recBg = {
    'Strong Hire': 'rgba(0,255,136,0.1)',
    'Hire': 'rgba(0,212,255,0.1)',
    'Maybe': 'rgba(255,179,0,0.1)',
    'No Hire': 'rgba(255,61,113,0.1)',
  }[recommendation] ?? 'rgba(255,179,0,0.1)'

  const scoreDims = [
    { label: 'Resume Quality', value: r.resume_score ?? 0, icon: FileText },
    { label: 'JD Match', value: r.jd_match_score ?? 0, icon: Briefcase },
    { label: 'Experience', value: r.experience_score ?? 0, icon: TrendingUp },
    { label: 'Skills', value: r.skills_score ?? 0, icon: Code2 },
    { label: 'Education', value: r.education_score ?? 0, icon: GraduationCap },
  ]

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #7c3aed)' }}>
            <Brain size={18} className="text-white" />
          </div>
          <span className="font-display text-xl font-bold text-white">InterviewAI</span>
        </div>
        <div className="text-white/40 text-sm font-body">
          {session.candidateName} · {session.jobTitle}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {/* Overall fit score */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05 }}
          className="glass rounded-2xl p-6 flex flex-col items-center justify-center text-center"
        >
          {/* Circular score */}
          <div className="relative mb-4">
            <svg width="110" height="110" className="-rotate-90">
              <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
              <motion.circle
                cx="55" cy="55" r="46" fill="none"
                stroke={fitScore >= 75 ? '#00ff88' : fitScore >= 50 ? '#ffb300' : '#ff3d71'}
                strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 46}`}
                initial={{ strokeDashoffset: 2 * Math.PI * 46 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 46 * (1 - fitScore / 100) }}
                transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                style={{ filter: `drop-shadow(0 0 6px ${fitScore >= 75 ? '#00ff88' : fitScore >= 50 ? '#ffb300' : '#ff3d71'})` }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span
                className="font-display text-3xl font-black"
                style={{ color: fitScore >= 75 ? '#00ff88' : fitScore >= 50 ? '#ffb300' : '#ff3d71' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                {fitScore}
              </motion.span>
              <span className="text-white/30 text-xs">/100</span>
            </div>
          </div>

          <h2 className="font-display font-bold text-white text-base mb-2">Overall Fit Score</h2>

          {/* Recommendation badge */}
          <div className="px-4 py-1.5 rounded-full font-display font-semibold text-sm mb-3"
            style={{ background: recBg, color: recColor, border: `1px solid ${recColor}40` }}>
            {recommendation}
          </div>

          <p className="text-white/45 text-xs font-body leading-relaxed">
            {r.recommendation_reason ?? ''}
          </p>
        </motion.div>

        {/* Score breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass rounded-2xl p-6"
        >
          <h3 className="font-display font-semibold text-white text-sm mb-4 uppercase tracking-widest text-white/50">
            Score Breakdown
          </h3>
          <div className="space-y-3">
            {scoreDims.map(({ label, value, icon: Icon }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.06 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Icon size={12} className="text-white/40" />
                    <span className="text-white/60 text-xs font-body">{label}</span>
                  </div>
                  <span className="font-mono text-xs font-bold"
                    style={{ color: value >= 75 ? '#00ff88' : value >= 50 ? '#ffb300' : '#ff3d71' }}>
                    {value}/100
                  </span>
                </div>
                <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: value >= 75 ? '#00ff88' : value >= 50 ? '#ffb300' : '#ff3d71' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${value}%` }}
                    transition={{ duration: 0.8, delay: 0.2 + i * 0.06, ease: 'easeOut' }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Strengths & Gaps */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass rounded-2xl p-6 space-y-4"
        >
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={13} className="text-accent-green" />
              <span className="text-white/50 text-xs font-display uppercase tracking-widest">Resume Strengths</span>
            </div>
            <ul className="space-y-2">
              {(r.resume_strengths ?? []).map((s: string, i: number) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.05 }}
                  className="flex items-start gap-2 text-sm font-body text-white/65"
                >
                  <span className="text-accent-green shrink-0 mt-0.5">•</span>
                  {s}
                </motion.li>
              ))}
            </ul>
          </div>

          <div className="border-t border-white/6 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={13} className="text-accent-amber" />
              <span className="text-white/50 text-xs font-display uppercase tracking-widest">Gaps vs Job</span>
            </div>
            <ul className="space-y-2">
              {(r.resume_gaps ?? []).map((g: string, i: number) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className="flex items-start gap-2 text-sm font-body text-white/65"
                >
                  <span className="text-accent-amber shrink-0 mt-0.5">→</span>
                  {g}
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>

      {/* Candidate summary */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass rounded-2xl p-5 mb-5"
      >
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
            style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.3)' }}>
            <Star size={14} className="text-accent-cyan" />
          </div>
          <div>
            <p className="text-white/40 text-xs font-display uppercase tracking-widest mb-1">AI Assessment</p>
            <p className="text-white/80 text-sm font-body leading-relaxed">
              {r.candidate_summary} {r.role_fit_assessment}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Questions preview */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass rounded-2xl p-6 mb-6"
      >
        <h3 className="font-display font-semibold text-white mb-4">
          Your Interview Questions
          <span className="text-white/30 text-sm font-normal ml-2">({session.analysisResult.questions.length} questions)</span>
        </h3>
        <div className="space-y-3">
          {session.analysisResult.questions.map((q, i) => (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.07 }}
              className="glass-bright rounded-xl p-4 flex items-start gap-4"
            >
              <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center font-mono text-xs font-bold text-white/50"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/85 text-sm font-body leading-relaxed mb-2">{q.question}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-md text-xs font-display font-semibold"
                    style={{
                      background: q.difficulty === 'Easy' ? 'rgba(0,255,136,0.1)' : q.difficulty === 'Hard' ? 'rgba(255,61,113,0.1)' : 'rgba(255,179,0,0.1)',
                      color: q.difficulty === 'Easy' ? '#00ff88' : q.difficulty === 'Hard' ? '#ff3d71' : '#ffb300',
                    }}>
                    {q.difficulty}
                  </span>
                  <span className="text-white/30 text-xs font-body">{q.category}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Start button */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex justify-center"
      >
        <button
          onClick={onStartInterview}
          className="btn-primary flex items-center gap-3 text-white px-10 py-4 text-base"
        >
          <Brain size={18} />
          Start Interview
          <ArrowRight size={18} />
        </button>
      </motion.div>
    </div>
  )
}