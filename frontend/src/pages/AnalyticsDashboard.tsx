import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, Legend
} from 'recharts'
import {
  BarChart2, Users, TrendingUp, TrendingDown, Eye,
  Brain, Activity, Zap, Target, ArrowLeft, RefreshCw,
  Award, AlertTriangle, ChevronDown, Info
} from 'lucide-react'

// ── Synthetic data generator ──────────────────────────────────────────────────

const QUESTION_POOL = [
  'Describe a time you led a project under tight deadlines.',
  'How do you approach debugging a production issue?',
  'Tell me about a conflict with a teammate and how you resolved it.',
  'Explain a complex technical concept to a non-technical stakeholder.',
  'How do you prioritize tasks when everything is urgent?',
  'Describe your experience with system design at scale.',
  'Tell me about a project where you failed and what you learned.',
  'How do you stay current with new technologies?',
  'Walk me through your approach to code reviews.',
  'Describe a time you influenced a decision without authority.',
]

const CATEGORIES = ['Behavioral', 'Technical', 'Situational', 'Competency', 'Culture Fit']
const JOB_ROLES  = ['Frontend Engineer', 'Backend Engineer', 'Full Stack Dev', 'ML Engineer', 'Product Manager']
const NAMES = [
  'Arjun Sharma','Priya Patel','Rahul Verma','Sneha Iyer','Amit Gupta',
  'Neha Singh','Vikram Rao','Kavya Nair','Rohan Mehta','Deepa Krishnan',
  'Siddharth Joshi','Ananya Kumar','Karan Malhotra','Riya Desai','Varun Pillai',
  'Shreya Nair','Aakash Tiwari','Pooja Shah','Manish Agarwal','Tanvi Reddy',
  'Harsh Bhatia','Divya Srivastava','Nikhil Saxena','Anjali Mishra','Suresh Pandey',
  'Meera Venkat','Rohit Chandra','Preethi Babu','Vivek Kapoor','Lakshmi Narayanan',
]

function gaussianRandom(mean: number, std: number): number {
  const u = 1 - Math.random()
  const v = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  return Math.max(0, Math.min(100, Math.round(mean + z * std)))
}

function clamp(v: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)) }

interface CandidateSession {
  id: number
  name: string
  role: string
  overallScore: number
  clarity: number
  technical: number
  bodyLanguage: number
  confidence: number
  communication: number
  eyeContact: number        // 0-100
  stressAvg: number         // 0-100
  happyAvg: number          // 0-100
  questionScores: { q: string; category: string; score: number }[]
  emotionPattern: 'calm' | 'nervous' | 'improving' | 'declining'
  wpm: number
}

function generateSessions(n = 150): CandidateSession[] {
  const sessions: CandidateSession[] = []

  for (let i = 0; i < n; i++) {
    // Each candidate has a latent skill level that drives correlations
    const latentSkill = Math.random()  // 0-1
    const isNervous   = Math.random() < 0.3

    const eyeContact   = clamp(gaussianRandom(latentSkill * 50 + 40, 15))
    const confidence   = clamp(gaussianRandom(latentSkill * 55 + 30 - (isNervous ? 15 : 0), 14))
    const clarity      = clamp(gaussianRandom(latentSkill * 50 + 35, 16))
    const technical    = clamp(gaussianRandom(latentSkill * 60 + 25, 18))
    const bodyLang     = clamp(gaussianRandom(eyeContact * 0.5 + confidence * 0.3 + 15, 12))
    const communication = clamp(gaussianRandom((clarity + confidence) / 2 + 5, 10))
    const stressAvg    = clamp(100 - confidence + gaussianRandom(0, 8))
    const happyAvg     = clamp(gaussianRandom(latentSkill * 40 + 35, 15))

    // Pick 5 random questions
    const qs = [...QUESTION_POOL].sort(() => Math.random() - 0.5).slice(0, 5)
    const questionScores = qs.map((q, qi) => ({
      q,
      category: CATEGORIES[qi % CATEGORIES.length],
      score: clamp(gaussianRandom(latentSkill * 50 + 30 + qi * 2, 18)),
    }))

    const overall = clamp(Math.round(
      clarity * 0.20 + technical * 0.25 + bodyLang * 0.15 +
      confidence * 0.20 + communication * 0.20
    ))

    const patterns: CandidateSession['emotionPattern'][] = ['calm', 'nervous', 'improving', 'declining']
    const emotionPattern = isNervous ? 'nervous'
      : latentSkill > 0.7 ? 'calm'
      : Math.random() < 0.5 ? 'improving' : 'declining'

    sessions.push({
      id: i,
      name: NAMES[i % NAMES.length],
      role: JOB_ROLES[i % JOB_ROLES.length],
      overallScore: overall,
      clarity, technical, bodyLanguage: bodyLang, confidence, communication,
      eyeContact, stressAvg, happyAvg,
      questionScores,
      emotionPattern,
      wpm: clamp(gaussianRandom(130 + latentSkill * 40, 25), 60, 220),
    })
  }
  return sessions
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const scoreColor = (s: number) =>
  s >= 75 ? '#00ff88' : s >= 55 ? '#ffb300' : '#ff3d71'

const scoreGradient = (s: number) =>
  s >= 75 ? 'from-green-500/20 to-green-500/5'
  : s >= 55 ? 'from-amber-500/20 to-amber-500/5'
  : 'from-red-500/20 to-red-500/5'

const COLORS = {
  cyan:   '#00d4ff',
  violet: '#7c3aed',
  green:  '#00ff88',
  amber:  '#ffb300',
  red:    '#ff3d71',
  pink:   '#f472b6',
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color, delay = 0 }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string; delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="glass rounded-2xl p-5 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 -translate-y-8 translate-x-8"
        style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)` }} />
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
          <div style={{ color }}>{icon}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold" style={{ color }}>{value}</div>
          {sub && <div className="text-white/30 text-xs font-display mt-0.5">{sub}</div>}
        </div>
      </div>
      <div className="text-white/45 text-xs font-display font-semibold uppercase tracking-widest">{label}</div>
    </motion.div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-bright rounded-xl px-3 py-2 text-xs font-display border border-white/10">
      {label && <div className="text-white/50 mb-1">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-white/70">{p.name || p.dataKey}:</span>
          <span className="font-bold" style={{ color: p.color || p.fill }}>
            {typeof p.value === 'number' ? Math.round(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

export function AnalyticsDashboard({ onBack }: Props) {
  const [sessions]   = useState(() => generateSessions(150))
  const [activeTab, setActiveTab] = useState<'overview' | 'questions' | 'correlation' | 'emotion'>('overview')
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)

  // ── Derived data ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const avg = (key: keyof CandidateSession) =>
      Math.round(sessions.reduce((s, c) => s + (c[key] as number), 0) / sessions.length)

    const passing    = sessions.filter(s => s.overallScore >= 60).length
    const excellent  = sessions.filter(s => s.overallScore >= 80).length
    const scoresDist = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}–${i * 10 + 9}`,
      count: sessions.filter(s => s.overallScore >= i * 10 && s.overallScore < i * 10 + 10).length,
    }))

    return {
      avgOverall: avg('overallScore'), avgConfidence: avg('confidence'),
      avgTechnical: avg('technical'), avgEyeContact: avg('eyeContact'),
      passing, excellent, scoresDist,
      passRate: Math.round((passing / sessions.length) * 100),
    }
  }, [sessions])

  // Question hardness — aggregate scores per question text
  const questionDifficulty = useMemo(() => {
    const map: Record<string, number[]> = {}
    sessions.forEach(s =>
      s.questionScores.forEach(q => {
        if (!map[q.q]) map[q.q] = []
        map[q.q].push(q.score)
      })
    )
    return Object.entries(map)
      .map(([q, scores]) => ({
        q: q.length > 42 ? q.slice(0, 42) + '…' : q,
        full: q,
        avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        n: scores.length,
      }))
      .sort((a, b) => a.avg - b.avg)
  }, [sessions])

  // Eye contact vs confidence scatter
  const scatterData = useMemo(() =>
    sessions.map(s => ({ x: s.eyeContact, y: s.confidence, score: s.overallScore, name: s.name }))
  , [sessions])

  // Emotion pattern → avg score
  const emotionVsScore = useMemo(() => {
    const patterns = ['calm', 'improving', 'declining', 'nervous'] as const
    return patterns.map(p => ({
      pattern: p.charAt(0).toUpperCase() + p.slice(1),
      avgScore: Math.round(
        sessions.filter(s => s.emotionPattern === p)
          .reduce((sum, s) => sum + s.overallScore, 0) /
        Math.max(sessions.filter(s => s.emotionPattern === p).length, 1)
      ),
      count: sessions.filter(s => s.emotionPattern === p).length,
      color: p === 'calm' ? COLORS.green : p === 'improving' ? COLORS.cyan
        : p === 'declining' ? COLORS.amber : COLORS.red,
    }))
  }, [sessions])

  // Emotion breakdown bars per pattern (stress, happy, confidence)
  const emotionBreakdown = useMemo(() => {
    const patterns = ['calm', 'improving', 'declining', 'nervous'] as const
    return patterns.map(p => {
      const group = sessions.filter(s => s.emotionPattern === p)
      const avg = (key: keyof CandidateSession) =>
        Math.round(group.reduce((s, c) => s + (c[key] as number), 0) / Math.max(group.length, 1))
      return {
        name: p.charAt(0).toUpperCase() + p.slice(1),
        Confidence: avg('confidence'),
        Happiness: avg('happyAvg'),
        Stress: avg('stressAvg'),
        'Eye Contact': avg('eyeContact'),
      }
    })
  }, [sessions])

  // Radar for dimension averages
  const radarData = useMemo(() => [
    { dim: 'Clarity',      val: Math.round(sessions.reduce((s,c) => s + c.clarity, 0) / sessions.length) },
    { dim: 'Technical',    val: Math.round(sessions.reduce((s,c) => s + c.technical, 0) / sessions.length) },
    { dim: 'Body Lang',    val: Math.round(sessions.reduce((s,c) => s + c.bodyLanguage, 0) / sessions.length) },
    { dim: 'Confidence',   val: Math.round(sessions.reduce((s,c) => s + c.confidence, 0) / sessions.length) },
    { dim: 'Comms',        val: Math.round(sessions.reduce((s,c) => s + c.communication, 0) / sessions.length) },
  ], [sessions])

  const tabs = [
    { id: 'overview',     label: 'Overview',     icon: <BarChart2 size={14} /> },
    { id: 'questions',    label: 'Questions',    icon: <Target size={14} /> },
    { id: 'correlation',  label: 'Eye Contact',  icon: <Eye size={14} /> },
    { id: 'emotion',      label: 'Emotions',     icon: <Activity size={14} /> },
  ] as const

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-7xl mx-auto">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack}
            className="btn-ghost flex items-center gap-2 text-sm">
            <ArrowLeft size={15} /> Back
          </button>
          <div>
            <h1 className="font-display font-bold text-2xl text-white flex items-center gap-2">
              <BarChart2 size={20} className="text-accent-cyan" />
              Candidate Analytics
            </h1>
            <p className="text-white/30 text-xs font-body mt-0.5">
              {sessions.length} simulated interview sessions · synthetic data
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-display"
          style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)', color: '#00d4ff' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
          Live Simulation
        </div>
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<Users size={16} />}    label="Total Candidates"  value={sessions.length}          color={COLORS.cyan}   delay={0.05} />
        <StatCard icon={<Award size={16} />}    label="Avg Overall Score" value={`${stats.avgOverall}/100`} sub="across all sessions" color={COLORS.violet} delay={0.1} />
        <StatCard icon={<TrendingUp size={16}/>} label="Pass Rate"         value={`${stats.passRate}%`}      sub="score ≥ 60"      color={COLORS.green}  delay={0.15} />
        <StatCard icon={<Zap size={16} />}      label="Top Performers"    value={stats.excellent}           sub="score ≥ 80"      color={COLORS.amber}  delay={0.2} />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 glass rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-display font-semibold transition-all duration-200"
            style={activeTab === t.id
              ? { background: 'rgba(124,58,237,0.3)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)' }
              : { color: 'rgba(255,255,255,0.35)', border: '1px solid transparent' }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── TAB: OVERVIEW ── */}
        {activeTab === 'overview' && (
          <motion.div key="overview"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Score Distribution */}
            <div className="glass rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
                <BarChart2 size={12} className="text-accent-cyan" />
                Score Distribution
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.scoresDist} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="range" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="count" name="Candidates" radius={[4, 4, 0, 0]}>
                    {stats.scoresDist.map((entry, i) => (
                      <Cell key={i} fill={
                        i >= 8 ? COLORS.green : i >= 6 ? COLORS.cyan : i >= 4 ? COLORS.amber : COLORS.red
                      } fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-3 mt-2 justify-center">
                {[['0–39', COLORS.red], ['40–59', COLORS.amber], ['60–79', COLORS.cyan], ['80–100', COLORS.green]].map(([l, c]) => (
                  <div key={l} className="flex items-center gap-1 text-white/35 text-xs">
                    <div className="w-2 h-2 rounded-sm" style={{ background: c as string }} />
                    {l}
                  </div>
                ))}
              </div>
            </div>

            {/* Dimension Radar */}
            <div className="glass rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
                <Brain size={12} className="text-accent-violet" />
                Avg Score by Dimension
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={radarData} outerRadius={80}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'monospace' }} />
                  <Radar name="Avg" dataKey="val" stroke={COLORS.violet} fill={COLORS.violet} fillOpacity={0.25} strokeWidth={2} />
                  <Tooltip content={<CustomTooltip />} />
                </RadarChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-5 gap-1 mt-1">
                {radarData.map(d => (
                  <div key={d.dim} className="text-center">
                    <div className="font-mono text-sm font-bold" style={{ color: scoreColor(d.val) }}>{d.val}</div>
                    <div className="text-white/25 text-xs">{d.dim.slice(0, 4)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top 10 scorers */}
            <div className="glass rounded-2xl p-5 lg:col-span-2">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-4 flex items-center gap-2">
                <Award size={12} className="text-accent-amber" />
                Top Candidates
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[...sessions].sort((a, b) => b.overallScore - a.overallScore).slice(0, 10).map((s, i) => (
                  <motion.div key={s.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className={`rounded-xl p-3 bg-gradient-to-b ${scoreGradient(s.overallScore)} border border-white/6`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-white/20 font-mono text-xs">#{i + 1}</span>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: scoreColor(s.overallScore) }} />
                    </div>
                    <div className="text-white/80 text-xs font-display font-semibold leading-tight mb-0.5">{s.name}</div>
                    <div className="text-white/30 text-xs">{s.role.split(' ').slice(-1)[0]}</div>
                    <div className="font-mono font-bold text-lg mt-1" style={{ color: scoreColor(s.overallScore) }}>
                      {s.overallScore}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── TAB: QUESTIONS ── */}
        {activeTab === 'questions' && (
          <motion.div key="questions"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="space-y-4">

            <div className="glass rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-1 flex items-center gap-2">
                <AlertTriangle size={12} className="text-accent-red" />
                Hardest Questions — Lowest Average Score
              </h3>
              <p className="text-white/25 text-xs mb-5">Questions candidates struggled with most across all sessions</p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={questionDifficulty} layout="vertical" barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="q" width={200}
                    tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10, fontFamily: 'monospace' }}
                    axisLine={false} tickLine={false} />
                  <ReferenceLine x={60} stroke="rgba(0,212,255,0.3)" strokeDasharray="4 4" label={{ value: 'Pass', fill: '#00d4ff', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="avg" name="Avg Score" radius={[0, 4, 4, 0]}>
                    {questionDifficulty.map((q, i) => (
                      <Cell key={i} fill={scoreColor(q.avg)} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Hardest 3 with detail */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {questionDifficulty.slice(0, 3).map((q, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="glass rounded-2xl p-4 border-l-2"
                  style={{ borderColor: scoreColor(q.avg) }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-white/20 text-xs font-mono">#{i + 1} Hardest</span>
                    <div className="ml-auto font-mono font-bold text-lg" style={{ color: scoreColor(q.avg) }}>
                      {q.avg}/100
                    </div>
                  </div>
                  <p className="text-white/65 text-xs font-body leading-relaxed mb-3">{q.full}</p>
                  <div className="flex items-center justify-between text-white/25 text-xs">
                    <span>{q.n} attempts</span>
                    <span className="font-display" style={{ color: scoreColor(q.avg) }}>
                      {q.avg < 40 ? 'Very Hard' : q.avg < 55 ? 'Hard' : 'Medium'}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── TAB: EYE CONTACT CORRELATION ── */}
        {activeTab === 'correlation' && (
          <motion.div key="correlation"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="space-y-4">

            <div className="glass rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-1 flex items-center gap-2">
                <Eye size={12} className="text-accent-cyan" />
                Eye Contact vs Confidence Score
              </h3>
              <p className="text-white/25 text-xs mb-5">Each dot is a candidate · color = overall score</p>
              <ResponsiveContainer width="100%" height={340}>
                <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis type="number" dataKey="x" name="Eye Contact" domain={[0, 100]}
                    label={{ value: 'Eye Contact %', position: 'insideBottom', offset: -4, fill: 'rgba(255,255,255,0.3)', fontSize: 11 }}
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="number" dataKey="y" name="Confidence" domain={[0, 100]}
                    label={{ value: 'Confidence', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 11 }}
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.1)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="glass-bright rounded-xl px-3 py-2 text-xs font-display border border-white/10">
                          <div className="text-white/80 font-semibold mb-1">{d.name}</div>
                          <div className="text-white/50">Eye Contact: <span className="text-accent-cyan font-mono">{d.x}%</span></div>
                          <div className="text-white/50">Confidence: <span className="text-accent-violet font-mono">{d.y}</span></div>
                          <div className="text-white/50">Overall: <span className="font-mono font-bold" style={{ color: scoreColor(d.score) }}>{d.score}</span></div>
                        </div>
                      )
                    }}
                  />
                  <Scatter data={scatterData} shape={(props: any) => {
                    const { cx, cy, payload } = props
                    return <circle cx={cx} cy={cy} r={4} fill={scoreColor(payload.score)} fillOpacity={0.65} stroke="none" />
                  }} />
                  {/* Trend line reference */}
                  <ReferenceLine stroke="rgba(0,212,255,0.15)" strokeWidth={1.5}
                    segment={[{ x: 20, y: 25 }, { x: 85, y: 80 }]} strokeDasharray="6 3" />
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-center mt-2">
                {[['< 55', COLORS.red], ['55–74', COLORS.amber], ['≥ 75', COLORS.green]].map(([l, c]) => (
                  <div key={l} className="flex items-center gap-1.5 text-white/35 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: c as string }} />
                    Overall {l}
                  </div>
                ))}
              </div>
            </div>

            {/* Insight cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  label: 'High Eye Contact (>70%)',
                  group: sessions.filter(s => s.eyeContact > 70),
                  icon: <Eye size={14} />, color: COLORS.green,
                  insight: 'tend to score higher on confidence',
                },
                {
                  label: 'Low Eye Contact (<40%)',
                  group: sessions.filter(s => s.eyeContact < 40),
                  icon: <TrendingDown size={14} />, color: COLORS.red,
                  insight: 'show higher stress & lower scores',
                },
                {
                  label: 'Mid Eye Contact (40–70%)',
                  group: sessions.filter(s => s.eyeContact >= 40 && s.eyeContact <= 70),
                  icon: <Activity size={14} />, color: COLORS.amber,
                  insight: 'most common group — mixed outcomes',
                },
              ].map(({ label, group, icon, color, insight }) => {
                const avgScore = Math.round(group.reduce((s, c) => s + c.overallScore, 0) / Math.max(group.length, 1))
                const avgConf  = Math.round(group.reduce((s, c) => s + c.confidence, 0) / Math.max(group.length, 1))
                return (
                  <div key={label} className="glass rounded-2xl p-4" style={{ borderTop: `2px solid ${color}40` }}>
                    <div className="flex items-center gap-2 mb-3" style={{ color }}>
                      {icon}
                      <span className="text-xs font-display font-semibold">{label}</span>
                    </div>
                    <div className="flex gap-4 mb-3">
                      <div>
                        <div className="font-mono font-bold text-xl" style={{ color }}>{avgScore}</div>
                        <div className="text-white/30 text-xs">avg score</div>
                      </div>
                      <div>
                        <div className="font-mono font-bold text-xl text-white/70">{avgConf}</div>
                        <div className="text-white/30 text-xs">avg conf.</div>
                      </div>
                      <div>
                        <div className="font-mono font-bold text-xl text-white/70">{group.length}</div>
                        <div className="text-white/30 text-xs">candidates</div>
                      </div>
                    </div>
                    <p className="text-white/35 text-xs font-body italic">{insight}</p>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}

        {/* ── TAB: EMOTION PATTERNS ── */}
        {activeTab === 'emotion' && (
          <motion.div key="emotion"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="space-y-4">

            {/* Pattern → Score bars */}
            <div className="glass rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-1 flex items-center gap-2">
                <Activity size={12} className="text-accent-violet" />
                Emotion Pattern vs Final Score
              </h3>
              <p className="text-white/25 text-xs mb-5">How a candidate's emotional arc during the interview correlates with their outcome</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={emotionVsScore} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="pattern" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={60} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4"
                    label={{ value: 'Pass threshold', fill: 'rgba(255,255,255,0.25)', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="avgScore" name="Avg Score" radius={[6, 6, 0, 0]}>
                    {emotionVsScore.map((e, i) => (
                      <Cell key={i} fill={e.color} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Breakdown grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

              {/* Emotion metrics per pattern */}
              <div className="glass rounded-2xl p-5">
                <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-4">
                  Emotion Metrics by Pattern
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={emotionBreakdown} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
                    <Bar dataKey="Confidence"   fill={COLORS.violet} fillOpacity={0.8} radius={[3,3,0,0]} />
                    <Bar dataKey="Happiness"    fill={COLORS.green}  fillOpacity={0.8} radius={[3,3,0,0]} />
                    <Bar dataKey="Stress"       fill={COLORS.red}    fillOpacity={0.8} radius={[3,3,0,0]} />
                    <Bar dataKey="Eye Contact"  fill={COLORS.cyan}   fillOpacity={0.8} radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Pattern cards */}
              <div className="space-y-2">
                {emotionVsScore.map((p, i) => (
                  <motion.div key={p.pattern} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="glass-bright rounded-xl p-3 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${p.color}18`, border: `1px solid ${p.color}30` }}>
                      <div className="font-mono font-bold text-sm" style={{ color: p.color }}>
                        {p.avgScore}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white/70 text-sm font-display font-semibold">{p.pattern}</span>
                        <span className="text-white/30 text-xs">{p.count} candidates</span>
                      </div>
                      <div className="h-1.5 bg-white/6 rounded-full overflow-hidden">
                        <motion.div className="h-full rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${p.avgScore}%` }}
                          transition={{ delay: 0.3 + i * 0.06, duration: 0.7, ease: 'easeOut' }}
                          style={{ background: p.color }} />
                      </div>
                    </div>
                    <div className="text-xs font-display text-right shrink-0">
                      <div className="font-bold" style={{ color: p.color }}>{p.avgScore}/100</div>
                      <div className="text-white/25">avg</div>
                    </div>
                  </motion.div>
                ))}

                <div className="glass rounded-xl p-3 mt-2">
                  <div className="flex items-start gap-2">
                    <Info size={12} className="text-accent-cyan mt-0.5 shrink-0" />
                    <p className="text-white/35 text-xs font-body leading-relaxed">
                      Candidates with a <span className="text-accent-green font-semibold">calm</span> emotional pattern score highest on average.
                      Those who show <span className="text-accent-cyan font-semibold">improving</span> emotions mid-interview also do well.
                      <span className="text-accent-red font-semibold"> Nervous</span> patterns correlate most strongly with lower scores.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}