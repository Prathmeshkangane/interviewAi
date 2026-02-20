import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileText, Briefcase, ArrowRight, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react'
import { analyzeDocs } from '../lib/api'
import type { AnalyzeDocsResponse } from '../lib/api'

interface Props {
  onComplete: (data: AnalyzeDocsResponse, candidateName: string, jobTitle: string, jobDescription: string) => void
}

export function UploadScreen({ onComplete }: Props) {
  const [resume, setResume] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [candidateName, setCandidateName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.pdf')) {
      setError('Please upload a PDF resume.')
      return
    }
    setResume(file)
    setError(null)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const handleSubmit = async () => {
    if (!resume || !jobDescription || !candidateName || !jobTitle) {
      setError('Please fill in all fields.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await analyzeDocs(resume, jobDescription)
      onComplete(result, candidateName, jobTitle, jobDescription)
    } catch (err: any) {
      setError(err.message || 'Analysis failed. Check your API key and server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      {/* Logo / Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center mb-12"
      >
        <div className="inline-flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #7c3aed)' }}>
            <Sparkles size={20} className="text-white" />
          </div>
          <span className="font-display text-2xl font-bold tracking-tight text-white">InterviewAI</span>
        </div>
        <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-3 tracking-tight">
          Precision Interview<br />
          <span style={{ background: 'linear-gradient(90deg, #00d4ff, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Intelligence
          </span>
        </h1>
        <p className="text-white/40 font-body text-lg max-w-md mx-auto leading-relaxed">
          AI-powered analysis of your speech, emotions, and technical knowledge in real time.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="glass rounded-2xl p-8 w-full max-w-2xl"
      >
        {/* Name & Title row */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="text-xs font-display font-semibold text-white/50 uppercase tracking-widest mb-2 block">
              Candidate Name
            </label>
            <input
              type="text"
              value={candidateName}
              onChange={e => setCandidateName(e.target.value)}
              placeholder="Your full name"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 font-body text-sm focus:outline-none focus:border-accent-cyan/50 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-display font-semibold text-white/50 uppercase tracking-widest mb-2 block">
              Target Role
            </label>
            <input
              type="text"
              value={jobTitle}
              onChange={e => setJobTitle(e.target.value)}
              placeholder="e.g. Senior Engineer"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 font-body text-sm focus:outline-none focus:border-accent-cyan/50 transition-colors"
            />
          </div>
        </div>

        {/* Resume Upload */}
        <div className="mb-6">
          <label className="text-xs font-display font-semibold text-white/50 uppercase tracking-widest mb-2 block">
            Resume (PDF)
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all duration-300 ${dragOver
                ? 'border-accent-cyan/60 bg-accent-cyan/5'
                : resume
                  ? 'border-accent-green/40 bg-accent-green/5'
                  : 'border-white/10 hover:border-white/25 bg-white/2'
              }`}
          >
            {resume ? (
              <>
                <CheckCircle2 size={28} className="text-accent-green" />
                <div className="text-center">
                  <p className="font-display font-semibold text-white">{resume.name}</p>
                  <p className="text-white/40 text-sm">{(resume.size / 1024).toFixed(0)} KB</p>
                </div>
              </>
            ) : (
              <>
                <Upload size={28} className="text-white/30" />
                <div className="text-center">
                  <p className="font-display font-medium text-white/70">Drop your PDF resume here</p>
                  <p className="text-white/35 text-sm mt-1">or click to browse</p>
                </div>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>

        {/* Job Description */}
        <div className="mb-8">
          <label className="text-xs font-display font-semibold text-white/50 uppercase tracking-widest mb-2 block">
            Job Description
          </label>
          <textarea
            value={jobDescription}
            onChange={e => setJobDescription(e.target.value)}
            placeholder="Paste the full job description here..."
            rows={5}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 font-body text-sm focus:outline-none focus:border-accent-cyan/50 transition-colors resize-none"
          />
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 flex items-center gap-2 text-accent-red text-sm bg-accent-red/10 border border-accent-red/20 rounded-xl px-4 py-3"
            >
              <AlertCircle size={16} />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2 text-white"
        >
          {loading ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
              />
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>Generate Interview Questions</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </motion.div>

      {/* Feature pills */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex flex-wrap justify-center gap-3 mt-8"
      >
        {[
          { icon: FileText, text: 'PDF Resume Parsing' },
          { icon: Sparkles, text: 'AI Powered' },
          { icon: Briefcase, text: 'Tailored Questions' },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-2 px-4 py-2 rounded-full glass text-white/50 text-xs font-display font-medium">
            <Icon size={12} className="text-accent-cyan" />
            {text}
          </div>
        ))}
      </motion.div>
    </div>
  )
}