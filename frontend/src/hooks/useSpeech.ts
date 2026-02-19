import { useState, useRef, useCallback, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

export interface SpeechState {
  transcript: string
  interimTranscript: string
  isListening: boolean
  wpm: number
  wordCount: number
  durationSeconds: number
  supported: boolean
}

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
  const accumulatedWordsRef = useRef<number>(0)

  const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

  const start = useCallback(() => {
    if (!state.supported) return

    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return
    const recognition: AnySpeechRecognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      startTimeRef.current = Date.now()
      setState(s => ({ ...s, isListening: true }))
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000
        setState(s => {
          const wpm = elapsed > 0 ? Math.round((s.wordCount / elapsed) * 60) : 0
          return { ...s, durationSeconds: elapsed, wpm }
        })
      }, 500)
    }

    recognition.onresult = (event: any) => {
      let finalText = ''
      let interimText = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript + ' '
        } else {
          interimText += result[0].transcript
        }
      }

      setState(s => {
        const newTranscript = s.transcript + finalText
        const totalWords = countWords(newTranscript)
        accumulatedWordsRef.current = totalWords
        return {
          ...s,
          transcript: newTranscript,
          interimTranscript: interimText,
          wordCount: totalWords,
        }
      })
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      if (event.error !== 'no-speech') {
        setState(s => ({ ...s, isListening: false }))
      }
    }

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current) {
        try { recognition.start() } catch {}
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [state.supported])

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setState(s => ({ ...s, isListening: false }))
  }, [])

  const reset = useCallback(() => {
    stop()
    accumulatedWordsRef.current = 0
    setState(s => ({
      ...s,
      transcript: '',
      interimTranscript: '',
      wpm: 0,
      wordCount: 0,
      durationSeconds: 0,
    }))
  }, [stop])

  useEffect(() => () => { stop() }, [stop])

  return { ...state, start, stop, reset }
}