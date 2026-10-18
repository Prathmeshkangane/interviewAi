import { useState, useRef, useCallback, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

export interface SpeechState {
  transcript: string
  interimTranscript: string
  isListening: boolean
  wpm: number           // rolling 10s window, 0 when silent
  wordCount: number
  durationSeconds: number
  supported: boolean
  error: string | null
}

export interface SpeechResult {
  transcript: string
  durationSeconds: number
}

const SUPPORTED =
  typeof window !== 'undefined' &&
  ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

const INITIAL: SpeechState = {
  transcript: '', interimTranscript: '', isListening: false, wpm: 0,
  wordCount: 0, durationSeconds: 0, supported: SUPPORTED, error: null,
}

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
const WPM_WINDOW_SECS = 10
const STOP_FLUSH_TIMEOUT_MS = 1500

export function useSpeech(lang: string = 'en-US') {
  const [state, setState] = useState<SpeechState>(INITIAL)

  const recognitionRef = useRef<AnySpeechRecognition | null>(null)
  const startTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const shouldRunRef = useRef(false)
  const langRef = useRef(lang)
  langRef.current = lang

  // Source of truth for the transcript (React state can be stale inside callbacks)
  const transcriptRef = useRef('')
  const interimRef = useRef('')
  const wordTimestampsRef = useRef<number[]>([])
  const lastWordCountRef = useRef(0)

  const computeRollingWPM = () => {
    const cutoff = Date.now() - WPM_WINDOW_SECS * 1000
    const recent = wordTimestampsRef.current.filter(t => t >= cutoff)
    if (recent.length < 2) return 0
    const span = (Date.now() - recent[0]) / 1000
    return span < 1 ? 0 : Math.round((recent.length / span) * 60)
  }

  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const start = useCallback(() => {
    if (!SUPPORTED) return
    const API = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!API) return

    shouldRunRef.current = true
    wordTimestampsRef.current = []
    lastWordCountRef.current = countWords(transcriptRef.current) // continues an answer after a "too short" restart
    setState(s => ({ ...s, error: null }))

    const recognition: AnySpeechRecognition = new API()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = langRef.current
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      if (startTimeRef.current === 0) startTimeRef.current = Date.now()
      setState(s => ({ ...s, isListening: true }))
    }

    recognition.onresult = (event: any) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const conf = result[0].confidence
        if (result.isFinal) {
          if (!conf || conf >= 0.6) finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      interimRef.current = interimText

      if (finalText) {
        const cleaned = (transcriptRef.current + ' ' + finalText).replace(/\s{2,}/g, ' ').trim()
        transcriptRef.current = cleaned
        const total = countWords(cleaned)
        const newWords = total - lastWordCountRef.current
        if (newWords > 0) {
          const now = Date.now()
          for (let i = 0; i < newWords; i++) wordTimestampsRef.current.push(now)
        }
        lastWordCountRef.current = total
        setState(s => ({ ...s, transcript: cleaned, interimTranscript: interimText, wordCount: total }))
      } else {
        setState(s => ({ ...s, interimTranscript: interimText }))
      }
    }

    recognition.onerror = (event: any) => {
      const code = event.error
      if (code === 'no-speech' || code === 'aborted') return  // normal during pauses
      let message: string
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        shouldRunRef.current = false   // stop the restart loop
        message = 'Microphone permission was denied. Allow microphone access in the address bar.'
      } else if (code === 'audio-capture') {
        message = 'No microphone was found.'
      } else if (code === 'network') {
        message = 'Speech recognition needs an internet connection (Chrome sends audio to Google).'
      } else {
        message = `Speech recognition error: ${code}`
      }
      console.warn('Speech recognition error:', code)
      setState(s => ({ ...s, error: message }))
    }

    recognition.onend = () => {
      if (shouldRunRef.current) {
        try { recognition.start() } catch { /* already starting */ }
      }
    }

    recognitionRef.current = recognition
    try { recognition.start() } catch { /* already started */ }

    clearTimer()
    timerRef.current = setInterval(() => {
      if (!shouldRunRef.current) return
      const elapsed = (Date.now() - startTimeRef.current) / 1000
      wordTimestampsRef.current = wordTimestampsRef.current.filter(
        t => t >= Date.now() - WPM_WINDOW_SECS * 1000
      )
      setState(s => ({ ...s, durationSeconds: elapsed, wpm: computeRollingWPM() }))
    }, 500)
  }, [])

  /** Stops listening, waits for the recognizer to flush its last sentence, returns the final answer. */
  const stop = useCallback((): Promise<SpeechResult> => {
    shouldRunRef.current = false
    clearTimer()
    const rec = recognitionRef.current
    recognitionRef.current = null

    const finish = (): SpeechResult => {
      let transcript = transcriptRef.current
      // If the last phrase never became "final", keep it rather than lose it
      if (interimRef.current.trim()) transcript = (transcript + ' ' + interimRef.current).replace(/\s{2,}/g, ' ').trim()
      transcriptRef.current = transcript
      interimRef.current = ''
      const durationSeconds = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0
      setState(s => ({
        ...s, isListening: false, wpm: 0, interimTranscript: '',
        transcript, wordCount: countWords(transcript), durationSeconds,
      }))
      return { transcript, durationSeconds }
    }

    if (!rec) return Promise.resolve(finish())

    return new Promise<SpeechResult>(resolve => {
      let done = false
      const complete = () => {
        if (done) return
        done = true
        clearTimeout(timeout)
        resolve(finish())
      }
      const timeout = setTimeout(complete, STOP_FLUSH_TIMEOUT_MS)
      rec.onend = complete          // fires after the final onresult
      try { rec.stop() } catch { complete() }
    })
  }, [])

  // Synchronous hard stop that discards everything (used by reset and unmount)
  const teardown = useCallback(() => {
    shouldRunRef.current = false
    clearTimer()
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      rec.onend = null; rec.onresult = null; rec.onerror = null
      try { rec.abort() } catch { /* ignore */ }
    }
  }, [])

  const reset = useCallback(() => {
    teardown()
    startTimeRef.current = 0
    transcriptRef.current = ''
    interimRef.current = ''
    lastWordCountRef.current = 0
    wordTimestampsRef.current = []
    setState(INITIAL)
  }, [teardown])

  useEffect(() => () => teardown(), [teardown])

  return { ...state, start, stop, reset }
}