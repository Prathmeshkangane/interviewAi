import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  LineChart, Line, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, LabelList,
} from 'recharts'
import { ArrowLeft, History, Trash2, TrendingUp, TrendingDown, Award, Hash, Target } from 'lucide-react'
import { clearHistory, deleteSession, loadHistory } from '../lib/history'
import type { SessionRecord } from '../lib/history'

interface Props {
  onBack: () => void
}

const COLORS = {
  cyan: '#00d4ff', violet: '#7c3aed', green: '#00ff88', amber: '#ffb300', red: '#ff3d71',
}
const CATEGORY_COLORS: Record<string, string> = {
  Behavioral: '#00d4ff', Technical: '#7c3aed', Situational: '#ffb300',
  Competency: '#00ff88', 'Culture Fit': '#ff3d71',
}
const scoreColor = (s: number) => (s >= 75 ? COLORS.green : s >= 50 ? COLORS.amber : COLORS.red)
const mean = (v: number[]) => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0)
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const longDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const axisTick = { fill: 'rgba(255,255,255,0.35)', fontSize: 10 }

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-bright rounded-xl px-3 py-2 text-xs font-display border border-white/10">
      {label && <div className="text-white/50 mb-1">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color || p.fill || p.stroke }} />
          <span className="text-white/70">{p.name}:</span>
          <span className="font-bold text-white/90">{Math.round(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${color}20`, border: `1px solid ${color}30`, color }}>
          {icon}
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold" style={{ color }}>{value}</div>
          {sub && <div className="text-white/30 text-xs font-display mt-0.5">{sub}</div>}
        </div>
      </div>
      <div className="text-white/45 text-xs font-display font-semibold uppercase tracking-widest">{label}</div>
    </div>
  )
}

export function SessionHistory({ onBack }: Props) {
  const [records, setRecords] = useState<SessionRecord[]>(() => loadHistory())   // newest first

  const chronological = useMemo(() => [...records].reverse(), [records])

  const stats = useMemo(() => {
    if (!records.length) return null
    const latest = records[0]
    const previous = records[1]
    return {
      count: records.length,
      latest: latest.scores.overall,
      delta: previous ? latest.scores.overall - previous.scores.overall : null,
      best: Math.max(...records.map(r => r.scores.overall)),
      average: mean(records.map(r => r.scores.overall)),
    }
  }, [records])

  const trendData = useMemo(
    () => chronological.map((r, i) => ({ name: `${i + 1} · ${shortDate(r.date)}`, Score: r.scores.overall })),
    [chronological]
  )

  // Latest session vs the average of all earlier sessions
  const radarData = useMemo(() => {
    if (!records.length) return []
    const latest = records[0]
    const earlier = records.slice(1)
    const avgOf = (pick: (r: SessionRecord) => number | null) => {
      const vals = earlier.map(pick).filter((v): v is number => v !== null)
      return vals.length ? mean(vals) : undefined
    }
    const dims: { dim: string; latest: number | null; pick: (r: SessionRecord) => number | null }[] = [
      { dim: 'Clarity', latest: latest.scores.clarity, pick: r => r.scores.clarity },
      { dim: 'Technical', latest: latest.scores.technical, pick: r => r.scores.technical },
      { dim: 'Body Lang.', latest: latest.scores.bodyLanguage, pick: r => r.scores.bodyLanguage },
      { dim: 'Confidence', latest: latest.scores.confidence, pick: r => r.scores.confidence },
      { dim: 'Comms.', latest: latest.scores.communication, pick: r => r.scores.communication },
    ]
    return dims
      .filter(d => d.latest !== null)    // body language is skipped when the camera never scored it
      .map(d => ({ dim: d.dim, Latest: d.latest as number, Earlier: avgOf(d.pick) }))
  }, [records])

  const categoryData = useMemo(() => {
    const map = new Map<string, number[]>()
    records.forEach(r => r.questions.forEach(q => {
      map.set(q.category, [...(map.get(q.category) ?? []), q.score])
    }))
    return [...map.entries()]
      .map(([category, scores]) => ({ category, avg: mean(scores), n: scores.length }))
      .sort((a, b) => a.avg - b.avg)
  }, [records])

  const handleDelete = (id: string) => setRecords(deleteSession(id))
  const handleClear = () => {
    if (window.confirm('Delete all saved sessions from this browser?')) setRecords(clearHistory())
  }

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="btn-ghost flex items-center gap-2 text-sm">
            <ArrowLeft size={15} /> Back
          </button>
          <div>
            <h1 className="font-display font-bold text-2xl text-white flex items-center gap-2">
              <History size={20} className="text-accent-cyan" />
              Your Progress
            </h1>
            <p className="text-white/30 text-xs font-body mt-0.5">
              Saved in this browser only · {records.length} session{records.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        {records.length > 0 && (
          <button onClick={handleClear} className="btn-ghost flex items-center gap-2 text-sm">
            <Trash2 size={14} /> Clear history
          </button>
        )}
      </motion.div>

      {!stats ? (
        <div className="glass rounded-2xl p-10 text-center">
          <History size={28} className="text-white/20 mx-auto mb-3" />
          <p className="text-white/60 font-display font-semibold mb-1">No sessions yet</p>
          <p className="text-white/35 text-sm font-body">
            Finish a mock interview and it will appear here, so you can track your progress over time.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Hash size={16} />} label="Sessions" value={String(stats.count)} color={COLORS.cyan} />
            <StatCard
              icon={stats.delta !== null && stats.delta < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
              label="Latest score" value={`${stats.latest}/100`}
              sub={stats.delta === null ? 'first session' : `${stats.delta >= 0 ? '+' : ''}${stats.delta} vs previous`}
              color={scoreColor(stats.latest)}
            />
            <StatCard icon={<Award size={16} />} label="Best score" value={`${stats.best}/100`} color={COLORS.amber} />
            <StatCard icon={<Target size={16} />} label="Average" value={`${stats.average}/100`} color={COLORS.violet} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Progress over time */}
            <div className="glass rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-4">
                Overall score over time
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
                  <Line type="monotone" dataKey="Score" stroke={COLORS.cyan} strokeWidth={2}
                    dot={{ r: 4, fill: COLORS.cyan, stroke: '#0a0a14', strokeWidth: 2 }}
                    activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Latest vs earlier */}
            <div className="glass rounded-2xl p-5">
              <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-4">
                {records.length > 1 ? 'Latest session vs your earlier average' : 'Latest session by dimension'}
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={radarData} outerRadius={80}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  {records.length > 1 && (
                    <Radar name="Earlier avg" dataKey="Earlier" stroke={COLORS.violet} fill={COLORS.violet}
                      fillOpacity={0.12} strokeWidth={2} strokeDasharray="5 3" />
                  )}
                  <Radar name="Latest" dataKey="Latest" stroke={COLORS.cyan} fill={COLORS.cyan}
                    fillOpacity={0.18} strokeWidth={2} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Category performance */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-1">
              Average score by question type
            </h3>
            <p className="text-white/25 text-xs font-body mb-4">Weakest first · across all saved sessions</p>
            <ResponsiveContainer width="100%" height={Math.max(120, categoryData.length * 46)}>
              <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }} barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="category" width={90} tick={{ ...axisTick, fontSize: 11 }}
                  axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="avg" name="Avg score" radius={[0, 4, 4, 0]}>
                  {categoryData.map(d => <Cell key={d.category} fill={CATEGORY_COLORS[d.category] ?? '#ffffff'} />)}
                  <LabelList dataKey="avg" position="right" fill="rgba(255,255,255,0.6)" fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Session list (also the table view of the trend chart) */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-white/60 text-xs font-display font-semibold uppercase tracking-widest mb-4">Sessions</h3>
            <div className="space-y-2">
              {records.map(r => (
                <div key={r.id} className="glass-bright rounded-xl px-4 py-3 flex items-center gap-4">
                  <div className="font-mono font-bold text-xl w-14 shrink-0" style={{ color: scoreColor(r.scores.overall) }}>
                    {r.scores.overall}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white/80 text-sm font-display font-semibold truncate">
                      {r.jobTitle || 'Interview'} · {r.candidateName}
                    </div>
                    <div className="text-white/30 text-xs font-body">
                      {longDate(r.date)} · {r.questions.length} questions
                      {r.scores.bodyLanguage !== null ? ` · body language ${r.scores.bodyLanguage}` : ''}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(r.id)} aria-label="Delete this session"
                    className="text-white/25 hover:text-accent-red transition-colors p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}