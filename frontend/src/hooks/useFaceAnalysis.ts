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
  faceDetected: boolean
}

// Smooth a value towards a target using exponential moving average
function ema(prev: number, next: number, alpha = 0.25): number {
  return prev * (1 - alpha) + next * alpha
}

export function useFaceAnalysis(videoRef: React.RefObject<HTMLVideoElement>) {
  const [emotions, setEmotions] = useState<EmotionState>({
    stress: 0.2,
    confidence: 0.5,
    neutral: 0.3,
    happy: 0,
    raw: {},
    ready: false,
    error: null,
    faceDetected: false,
  })

  const timelineRef = useRef<EmotionSnapshot[]>([])
  const animFrameRef = useRef<number>(0)
  const faceApiRef = useRef<any>(null)
  const isRunningRef = useRef(false)
  const prevEmotions = useRef({ stress: 0.2, confidence: 0.5, neutral: 0.3 })
  const frameCountRef = useRef(0)

  const loadModels = useCallback(async () => {
    try {
      const faceapi = await import('face-api.js')
      faceApiRef.current = faceapi
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model'
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      ])
      setEmotions(s => ({ ...s, ready: true, error: null }))
    } catch (err) {
      console.warn('face-api.js unavailable, using fallback:', err)
      setEmotions(s => ({ ...s, ready: true, error: 'Using simulated data' }))
    }
  }, [])

  const analyzeFrame = useCallback(async () => {
    if (!isRunningRef.current) return
    frameCountRef.current++

    // Only analyze every 6th frame (~5fps) to save CPU
    if (frameCountRef.current % 6 !== 0) {
      animFrameRef.current = requestAnimationFrame(analyzeFrame)
      return
    }

    const video = videoRef.current
    const faceapi = faceApiRef.current

    if (video && faceapi && video.readyState === 4 && video.videoWidth > 0) {
      try {
        const detection = await faceapi
          .detectSingleFace(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 })
          )
          .withFaceExpressions()

        if (detection) {
          const e = detection.expressions as Record<string, number>

          // ── Better emotion mapping ────────────────────────────────────────
          // Stress = fear + angry + disgusted (weighted)
          const rawStress = Math.min(1,
            (e.fearful ?? 0) * 1.2 +
            (e.angry ?? 0) * 0.9 +
            (e.disgusted ?? 0) * 0.5
          )

          // Confidence = happy + (1 - fearful) scaled by neutral baseline
          // High neutral + some happy = confident professional
          const rawConfidence = Math.min(1,
            (e.happy ?? 0) * 0.5 +
            (e.neutral ?? 0) * 0.4 +
            (1 - (e.fearful ?? 0)) * 0.25 -
            (e.sad ?? 0) * 0.3
          )

          const rawNeutral = e.neutral ?? 0

          // Smooth with EMA to avoid jitter
          const stress = ema(prevEmotions.current.stress, rawStress, 0.2)
          const confidence = Math.max(0, ema(prevEmotions.current.confidence, rawConfidence, 0.2))
          const neutral = ema(prevEmotions.current.neutral, rawNeutral, 0.2)

          prevEmotions.current = { stress, confidence, neutral }

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
            happy: e.happy ?? 0,
            raw: e,
            ready: true,
            error: null,
            faceDetected: true,
          })
        } else {
          // Face not detected — gradually decay to neutral
          const stress = ema(prevEmotions.current.stress, 0.1, 0.05)
          const confidence = ema(prevEmotions.current.confidence, 0.3, 0.05)
          const neutral = ema(prevEmotions.current.neutral, 0.6, 0.05)
          prevEmotions.current = { stress, confidence, neutral }
          setEmotions(s => ({ ...s, stress, confidence, neutral, faceDetected: false }))
        }
      } catch (err) {
        // Silently continue on frame errors
      }
    } else if (!faceapi && isRunningRef.current) {
      // ── Realistic simulation fallback ────────────────────────────────────
      const t = Date.now() / 4000
      // Simulate natural interview pattern: higher stress early, builds confidence
      const elapsed = timelineRef.current.length / 10
      const stressBase = Math.max(0.1, 0.4 - elapsed * 0.02)
      const confBase = Math.min(0.75, 0.35 + elapsed * 0.02)

      const rawStress = stressBase + 0.08 * Math.sin(t * 1.3) * Math.random()
      const rawConfidence = confBase + 0.06 * Math.cos(t * 0.8)
      const rawNeutral = Math.max(0, 1 - rawStress - Math.max(0, rawConfidence - 0.4))

      const stress = ema(prevEmotions.current.stress, rawStress, 0.15)
      const confidence = ema(prevEmotions.current.confidence, rawConfidence, 0.15)
      const neutral = ema(prevEmotions.current.neutral, rawNeutral, 0.15)
      prevEmotions.current = { stress, confidence, neutral }

      const snapshot: EmotionSnapshot = { timestamp: Date.now(), stress, confidence, neutral }
      timelineRef.current.push(snapshot)
      setEmotions(s => ({ ...s, stress, confidence, neutral, faceDetected: true }))
    }

    animFrameRef.current = requestAnimationFrame(analyzeFrame)
  }, [videoRef])

  const startAnalysis = useCallback(() => {
    isRunningRef.current = true
    timelineRef.current = []
    frameCountRef.current = 0
    prevEmotions.current = { stress: 0.2, confidence: 0.5, neutral: 0.3 }
    analyzeFrame()
  }, [analyzeFrame])

  const stopAnalysis = useCallback(() => {
    isRunningRef.current = false
    cancelAnimationFrame(animFrameRef.current)
  }, [])

  const getTimeline = useCallback(() => [...timelineRef.current], [])

  const getEmotionSummary = useCallback(() => {
    const tl = timelineRef.current
    if (!tl.length) return { stress: 0.2, confidence: 0.5, neutral: 0.3 }
    const avg = (key: keyof EmotionSnapshot) =>
      tl.reduce((sum, s) => sum + (s[key] as number), 0) / tl.length
    return {
      stress: avg('stress'),
      confidence: avg('confidence'),
      neutral: avg('neutral'),
    }
  }, [])

  useEffect(() => {
    loadModels()
    return () => stopAnalysis()
  }, [loadModels, stopAnalysis])

  return { emotions, startAnalysis, stopAnalysis, getTimeline, getEmotionSummary }
}