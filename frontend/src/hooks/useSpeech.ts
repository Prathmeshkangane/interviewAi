import { useState, useRef, useCallback, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

export interface SpeechState {
  transcript: string
  interimTranscript: string
  isListening: boolean
  wpm: number           // rolling 10s window — 0 when silent
  wordCount: number
  durationSeconds: number
  supported: boolean
}

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

// Rolling window: timestamps of each word spoken in last N seconds
const WPM_WINDOW_SECS = 10

export function useSpeech() {
  const [state, setState] = useState<SpeechState>({
    transcript: '',
    interimTranscript: '',
    isListening: false,
    wpm: 0,
    wordCount: 0,
    durationSeconds: 0,
    supported: 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window,
  })

  const recognitionRef = useRef<AnySpeechRecognition | null>(null)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const shouldRunRef = useRef(false)  // true while recording is active

  // Rolling WPM: store timestamp of every word spoken
  const wordTimestampsRef = useRef<number[]>([])
  // Track last word count to know how many new words arrived
  const lastWordCountRef = useRef<number>(0)

  // ── Compute rolling WPM ───────────────────────────────────────────────────
  // Only counts words spoken in the last WPM_WINDOW_SECS seconds.
  // Returns 0 if no words in that window (user is silent).
  const computeRollingWPM = (): number => {
    const cutoff = Date.now() - WPM_WINDOW_SECS * 1000
    const recent = wordTimestampsRef.current.filter(t => t >= cutoff)
    if (recent.length < 2) return 0  // need at least 2 words to compute rate
    const span = (Date.now() - recent[0]) / 1000
    if (span < 1) return 0
    return Math.round((recent.length / span) * 60)
  }

  const start = useCallback(() => {
    if (!state.supported) return
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return

    shouldRunRef.current = true
    wordTimestampsRef.current = []
    lastWordCountRef.current = 0

    const createRecognition = () => {
      const recognition: AnySpeechRecognition = new SpeechRecognitionAPI()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'
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
            // Accept if confidence is good or not provided (some browsers omit it)
            if (!conf || conf >= 0.60) {
              finalText += result[0].transcript
            }
          } else {
            interimText += result[0].transcript
          }
        }

        if (finalText) {
          setState(s => {
            const joined = (s.transcript + ' ' + finalText).trim()
            const cleaned = joined.replace(/\s{2,}/g, ' ')
            const total = countWords(cleaned)

            // Stamp a timestamp for every new word that arrived
            const newWords = total - lastWordCountRef.current
            if (newWords > 0) {
              const now = Date.now()
              for (let i = 0; i < newWords; i++) {
                wordTimestampsRef.current.push(now)
              }
              lastWordCountRef.current = total
            }

            return {
              ...s,
              transcript: cleaned,
              interimTranscript: interimText,
              wordCount: total,
            }
          })
        } else if (interimText) {
          setState(s => ({ ...s, interimTranscript: interimText }))
        }
      }

      recognition.onerror = (event: any) => {
        // 'no-speech' and 'aborted' are normal during pauses — just let onend restart
        if (event.error === 'no-speech' || event.error === 'aborted') return
        console.warn('Speech recognition error:', event.error)
      }

      recognition.onend = () => {
        // Auto-restart only if still recording
        if (shouldRunRef.current) {
          try { recognition.start() } catch { /* already starting */ }
        }
      }

      return recognition
    }

    const recognition = createRecognition()
    recognitionRef.current = recognition
    recognition.start()

    // ── Ticker: elapsed time + rolling WPM every 500ms ────────────────────
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      if (!shouldRunRef.current) return
      const elapsed = (Date.now() - startTimeRef.current) / 1000
      const rollingWpm = computeRollingWPM()

      // Prune timestamps older than the window to keep ref lean
      const cutoff = Date.now() - WPM_WINDOW_SECS * 1000
      wordTimestampsRef.current = wordTimestampsRef.current.filter(t => t >= cutoff)

      setState(s => ({ ...s, durationSeconds: elapsed, wpm: rollingWpm }))
    }, 500)

  }, [state.supported])

  const stop = useCallback(() => {
    shouldRunRef.current = false
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null  // prevent restart loop on stop
      try { recognitionRef.current.stop() } catch { /* ignore */ }
      recognitionRef.current = null
    }
    setState(s => ({ ...s, isListening: false, wpm: 0 }))
  }, [])

  const reset = useCallback(() => {
    stop()
    startTimeRef.current = 0
    lastWordCountRef.current = 0
    wordTimestampsRef.current = []
    setState({
      transcript: '',
      interimTranscript: '',
      isListening: false,
      wpm: 0,
      wordCount: 0,
      durationSeconds: 0,
      supported: 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window,
    })
  }, [stop])

  useEffect(() => () => { stop() }, [stop])

  return { ...state, start, stop, reset }
}