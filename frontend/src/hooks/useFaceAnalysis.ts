import { useState, useRef, useCallback, useEffect } from 'react'
import type { EmotionSnapshot } from '../lib/api'

export interface EmotionState {
  stress: number
  confidence: number
  neutral: number
  happy: number
  raw: Record<string, number>
  ready: boolean
  error: string | null
}

export function useFaceAnalysis(videoRef: React.RefObject<HTMLVideoElement>) {
  const [emotions, setEmotions] = useState<EmotionState>({
    stress: 0,
    confidence: 0,
    neutral: 1,
    happy: 0,
    raw: {},
    ready: false,
    error: null,
  })

  const timelineRef = useRef<EmotionSnapshot[]>([])
  const animFrameRef = useRef<number>(0)
  const faceApiRef = useRef<any>(null)
  const isRunningRef = useRef(false)

  const loadModels = useCallback(async () => {
    try {
      // Dynamically import face-api.js
      const faceapi = await import('face-api.js')
      faceApiRef.current = faceapi

      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model'

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      ])

      setEmotions(s => ({ ...s, ready: true, error: null }))
    } catch (err) {
      console.error('face-api.js model load error:', err)
      // Graceful fallback — still allow app to work with simulated data
      setEmotions(s => ({
        ...s,
        ready: true,
        error: 'Face models unavailable — using simulated emotion data',
      }))
    }
  }, [])

  const analyzeFrame = useCallback(async () => {
    if (!isRunningRef.current) return

    const video = videoRef.current
    const faceapi = faceApiRef.current

    if (video && faceapi && video.readyState === 4) {
      try {
        const detection = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
          .withFaceExpressions()

        if (detection) {
          const expr = detection.expressions
          // Map raw expressions → our metrics
          const stress = Math.min(1, (expr.fearful + expr.angry + expr.disgusted) * 1.5)
          const confidence = Math.min(1, expr.happy * 0.6 + (1 - expr.fearful) * 0.4)
          const neutral = expr.neutral

          const snapshot: EmotionSnapshot = {
            timestamp: Date.now(),
            stress,
            confidence,
            neutral,
          }
          timelineRef.current.push(snapshot)

          setEmotions({
            stress,
            confidence,
            neutral,
            happy: expr.happy,
            raw: { ...expr } as any,
            ready: true,
            error: null,
          })
        }
      } catch {}
    } else if (!faceapi) {
      // Simulate realistic emotion data when models unavailable
      const t = Date.now() / 3000
      const stress = 0.2 + 0.15 * Math.sin(t) * Math.random()
      const confidence = 0.55 + 0.2 * Math.cos(t * 0.7)
      const neutral = 1 - stress - Math.max(0, confidence - 0.5)

      const snapshot: EmotionSnapshot = { timestamp: Date.now(), stress, confidence, neutral }
      timelineRef.current.push(snapshot)
      setEmotions(s => ({ ...s, stress, confidence, neutral: Math.max(0, neutral) }))
    }

    animFrameRef.current = requestAnimationFrame(analyzeFrame)
  }, [videoRef])

  const startAnalysis = useCallback(() => {
    isRunningRef.current = true
    timelineRef.current = []
    analyzeFrame()
  }, [analyzeFrame])

  const stopAnalysis = useCallback(() => {
    isRunningRef.current = false
    cancelAnimationFrame(animFrameRef.current)
  }, [])

  const getTimeline = useCallback(() => [...timelineRef.current], [])

  const getEmotionSummary = useCallback(() => {
    const tl = timelineRef.current
    if (!tl.length) return { stress: 0, confidence: 0, neutral: 1 }
    const avg = (key: keyof EmotionSnapshot) =>
      tl.reduce((sum, s) => sum + (s[key] as number), 0) / tl.length
    return { stress: avg('stress'), confidence: avg('confidence'), neutral: avg('neutral') }
  }, [])

  useEffect(() => {
    loadModels()
    return () => stopAnalysis()
  }, [loadModels, stopAnalysis])

  return { emotions, startAnalysis, stopAnalysis, getTimeline, getEmotionSummary }
}