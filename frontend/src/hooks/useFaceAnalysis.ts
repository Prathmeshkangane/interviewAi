import { useState, useRef, useCallback, useEffect } from 'react'
import type { EmotionSnapshot } from '../lib/api'

export interface EmotionState {
  stress: number   // 0-1
  confidence: number   // 0-1
  neutral: number   // 0-1
  happy: number   // 0-1
  raw: Record<string, number>
  ready: boolean
  error: string | null
  faceDetected: boolean
  eyeContact: boolean
  eyeContactScore: number   // 0-100 running avg
  postureGood: boolean
  engagementScore: number   // 0-100
  blinkRate: number   // blinks per minute (last 60s)
  smileCount: number
  lookAwaySeconds: number
  alert: string | null
}

// Slow EMA — for bars that should feel stable
function ema(prev: number, next: number, alpha = 0.15): number {
  return prev * (1 - alpha) + next * alpha
}

// Clamp to [0,1]
function clamp(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function useFaceAnalysis(videoRef: React.RefObject<HTMLVideoElement>) {
  const [emotions, setEmotions] = useState<EmotionState>({
    stress: 0.15, confidence: 0.55, neutral: 0.4, happy: 0,
    raw: {}, ready: false, error: null, faceDetected: false,
    eyeContact: true, eyeContactScore: 100, postureGood: true,
    engagementScore: 80, blinkRate: 15, smileCount: 0,
    lookAwaySeconds: 0, alert: null,
  })

  const timelineRef = useRef<EmotionSnapshot[]>([])
  const animFrameRef = useRef<number>(0)
  const faceApiRef = useRef<any>(null)
  const isRunningRef = useRef(false)
  const frameCountRef = useRef(0)

  // Smooth state refs — separate from display state to avoid jitter
  const smoothStress = useRef(0.15)
  const smoothConfidence = useRef(0.55)
  const smoothNeutral = useRef(0.40)

  // Blink tracking
  const blinkWindowRef = useRef<number[]>([])
  const eyeOpennessHistRef = useRef<number[]>([])  // rolling 10-frame history
  const wasBlinkingRef = useRef(false)

  // Eye movement variability (proxy for anxiety / scanning)
  const eyeXHistRef = useRef<number[]>([])  // rolling 30-frame history
  const eyeYHistRef = useRef<number[]>([])

  // Posture
  const baselineFaceSizeRef = useRef(0)
  const baselineFramesRef = useRef(0)             // count frames to build baseline

  // Eye contact
  const eyeContactScoreRef = useRef(100)
  const consecutiveLookAwayRef = useRef(0)
  const lookAwayStartRef = useRef<number | null>(null)
  const totalLookAwaySecsRef = useRef(0)

  // Alert cooldown
  const alertCooldownRef = useRef(false)
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Smile
  const smileCountRef = useRef(0)
  const smileActiveRef = useRef(false)

  // ── Load models ───────────────────────────────────────────────────────────
  const loadModels = useCallback(async () => {
    try {
      const faceapi = await import('face-api.js')
      faceApiRef.current = faceapi
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model'
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      ])
      setEmotions(s => ({ ...s, ready: true, error: null }))
    } catch (err) {
      console.warn('face-api.js unavailable — simulation active:', err)
      setEmotions(s => ({ ...s, ready: true, error: 'simulation' }))
    }
  }, [])

  // ── Alert system ──────────────────────────────────────────────────────────
  const showAlert = useCallback((message: string) => {
    if (alertCooldownRef.current) return
    alertCooldownRef.current = true
    setEmotions(s => ({ ...s, alert: message }))
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
    alertTimeoutRef.current = setTimeout(() => {
      setEmotions(s => ({ ...s, alert: null }))
      setTimeout(() => { alertCooldownRef.current = false }, 10000)
    }, 3000)
  }, [])

  // ── Variance helper (how jumpy/variable a signal is) ─────────────────────
  function variance(arr: number[]): number {
    if (arr.length < 2) return 0
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
  }

  // ── Main frame analysis ───────────────────────────────────────────────────
  const analyzeFrame = useCallback(async () => {
    if (!isRunningRef.current) return
    frameCountRef.current++

    // Run at ~8fps (every 4th frame at 30fps)
    if (frameCountRef.current % 4 !== 0) {
      animFrameRef.current = requestAnimationFrame(analyzeFrame)
      return
    }

    const video = videoRef.current
    const faceapi = faceApiRef.current

    // ── REAL camera path ──────────────────────────────────────────────────
    if (video && faceapi && video.readyState === 4 && video.videoWidth > 0) {
      try {
        const detection = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,        // larger = more accurate expression detection
            scoreThreshold: 0.35,
          }))
          .withFaceLandmarks(true)
          .withFaceExpressions()

        if (detection) {
          const expr = detection.expressions as Record<string, number>
          const box = detection.detection.box
          const lms = detection.landmarks

          const videoW = video.videoWidth
          const videoH = video.videoHeight

          // ── BUILD FACE SIZE BASELINE (first 10 frames) ──────────────────
          const currentFaceSize = box.width * box.height
          if (baselineFramesRef.current < 10) {
            baselineFaceSizeRef.current =
              (baselineFaceSizeRef.current * baselineFramesRef.current + currentFaceSize) /
              (baselineFramesRef.current + 1)
            baselineFramesRef.current++
          }

          // ── POSTURE ────────────────────────────────────────────────────
          const sizeRatio = baselineFaceSizeRef.current > 0
            ? currentFaceSize / baselineFaceSizeRef.current : 1
          const postureGood = sizeRatio > 0.60
          if (!postureGood) showAlert("📐 Sit up straight — good posture signals confidence!")

          // ── EYE LANDMARKS ──────────────────────────────────────────────
          const leftEye = lms.getLeftEye()   // 6 points
          const rightEye = lms.getRightEye()  // 6 points

          // Eye centers
          const leftCX = leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length
          const leftCY = leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length
          const rightCX = rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length
          const rightCY = rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length
          const eyeMidX = (leftCX + rightCX) / 2
          const eyeMidY = (leftCY + rightCY) / 2

          // Normalise eye position relative to video frame
          const eyeNormX = eyeMidX / videoW  // 0=left, 0.5=center, 1=right
          const eyeNormY = eyeMidY / videoH

          // ── EYE CONTACT ────────────────────────────────────────────────
          // Looking away = eyes pulled significantly off center
          const deviationX = Math.abs(eyeNormX - 0.5)
          const faceCenterY = (box.y + box.height / 2) / videoH
          const deviationY = Math.abs(faceCenterY - 0.45)  // slight offset for natural camera angle
          const isLookingAway = deviationX > 0.18 || deviationY > 0.20

          if (isLookingAway) {
            consecutiveLookAwayRef.current++
            if (lookAwayStartRef.current === null) lookAwayStartRef.current = Date.now()
            if (consecutiveLookAwayRef.current === 16) {  // ~2 seconds at 8fps
              showAlert("👁️ Look at the camera — eye contact is critical in interviews!")
            }
          } else {
            if (lookAwayStartRef.current !== null) {
              totalLookAwaySecsRef.current += (Date.now() - lookAwayStartRef.current) / 1000
              lookAwayStartRef.current = null
            }
            consecutiveLookAwayRef.current = 0
          }

          eyeContactScoreRef.current = ema(eyeContactScoreRef.current, isLookingAway ? 0 : 100, 0.08)

          // ── EYE MOVEMENT VARIABILITY ───────────────────────────────────
          // High variability = anxious scanning. Rolling 30-frame window.
          eyeXHistRef.current.push(eyeNormX)
          eyeYHistRef.current.push(eyeNormY)
          if (eyeXHistRef.current.length > 30) eyeXHistRef.current.shift()
          if (eyeYHistRef.current.length > 30) eyeYHistRef.current.shift()
          const eyeVariability = Math.sqrt(
            variance(eyeXHistRef.current) + variance(eyeYHistRef.current)
          )
          // eyeVariability: ~0.005 = calm, ~0.02+ = anxious scanning

          // ── BLINK RATE ─────────────────────────────────────────────────
          // EAR = eye aspect ratio. Points: 0=left, 1=top-left, 2=top-right, 3=right, 4=bottom-right, 5=bottom-left
          const leftEAR = eyeAspectRatio(leftEye)
          const rightEAR = eyeAspectRatio(rightEye)
          const avgEAR = (leftEAR + rightEAR) / 2

          // Track rolling EAR to detect blinks (EAR dips below 0.2 = blink)
          eyeOpennessHistRef.current.push(avgEAR)
          if (eyeOpennessHistRef.current.length > 10) eyeOpennessHistRef.current.shift()

          const isBlink = avgEAR < 0.20 && !wasBlinkingRef.current
          const isOpen = avgEAR > 0.25
          if (isBlink) {
            wasBlinkingRef.current = true
            const now = Date.now()
            blinkWindowRef.current.push(now)
          }
          if (isOpen) wasBlinkingRef.current = false

          // Keep only blinks within last 60 seconds
          const now60 = Date.now()
          blinkWindowRef.current = blinkWindowRef.current.filter(t => now60 - t < 60000)
          const blinkRate = blinkWindowRef.current.length

          // Blink stress signal: >25/min = high stress, <8/min = forced staring (also stress)
          const blinkStressSignal = blinkRate > 25
            ? (blinkRate - 25) / 25        // normalise excess blinks → 0-1
            : blinkRate < 8 && blinkWindowRef.current.length >= 5
              ? (8 - blinkRate) / 8        // normalise too-few blinks → 0-1
              : 0

          // ── SMILE ──────────────────────────────────────────────────────
          const isSmiling = (expr.happy ?? 0) > 0.45
          if (isSmiling && !smileActiveRef.current) {
            smileCountRef.current++
            smileActiveRef.current = true
          } else if (!isSmiling) {
            smileActiveRef.current = false
          }

          // ── STRESS CALCULATION (rebuilt) ───────────────────────────────
          // Sources that actually fire in real interviews:
          //
          // 1. sad expression    → downturned mouth, furrowed brow (very common under stress)
          // 2. surprised         → wide eyes when caught off-guard
          // 3. fearful           → only included at low weight, rarely fires
          // 4. lack of smile     → absence of warmth is itself a stress proxy
          // 5. high blink rate   → rapid blinking = anxiety
          // 6. eye variability   → scanning around = nervous
          // 7. looking away      → correlated with stress
          //
          const sadSignal = (expr.sad ?? 0)                   // 0-1
          const surprisedSignal = (expr.surprised ?? 0) * 0.6            // partial
          const fearSignal = (expr.fearful ?? 0) * 0.4            // low weight
          const noSmileSignal = clamp(1 - (expr.happy ?? 0) * 2) * 0.3 // 0-0.3 when not smiling
          const blinkSignal = clamp(blinkStressSignal) * 0.4
          const eyeVarSignal = clamp(eyeVariability / 0.025) * 0.35   // 0-0.35
          const lookAwaySignal = isLookingAway ? 0.2 : 0

          const rawStress = clamp(
            sadSignal * 0.30 +
            surprisedSignal * 0.15 +
            fearSignal * 0.10 +
            noSmileSignal * 0.15 +
            blinkSignal * 0.15 +
            eyeVarSignal * 0.10 +
            lookAwaySignal * 0.05
          )

          // ── CONFIDENCE CALCULATION ─────────────────────────────────────
          // Sources:
          // 1. happy expression  → genuine warmth = confidence
          // 2. neutral           → composure, not stressed
          // 3. sustained eye contact → engaged
          // 4. low stress        → confidence proxy
          // 5. steady eyes       → not scanning anxiously
          //
          const happySignal = (expr.happy ?? 0)
          const neutralSignal = (expr.neutral ?? 0) * 0.6
          const eyeContact01 = clamp(eyeContactScoreRef.current / 100)
          const steadyEyes = clamp(1 - eyeVarSignal / 0.35)  // inverse of variability
          const calmBlinks = blinkRate >= 8 && blinkRate <= 25 ? 1.0 : 0.5

          const rawConfidence = clamp(
            happySignal * 0.30 +
            neutralSignal * 0.20 +
            eyeContact01 * 0.25 +
            steadyEyes * 0.15 +
            calmBlinks * 0.10
          )

          // ── NEUTRAL ────────────────────────────────────────────────────
          const rawNeutral = clamp(
            (expr.neutral ?? 0) * 0.7 +
            (1 - rawStress) * 0.2 +
            (1 - Math.abs(rawConfidence - 0.5)) * 0.1
          )

          // ── SMOOTH with slow EMA to prevent jitter ─────────────────────
          smoothStress.current = ema(smoothStress.current, rawStress, 0.12)
          smoothConfidence.current = ema(smoothConfidence.current, rawConfidence, 0.12)
          smoothNeutral.current = ema(smoothNeutral.current, rawNeutral, 0.12)

          const stress = smoothStress.current
          const confidence = smoothConfidence.current
          const neutral = smoothNeutral.current

          // ── HIGH STRESS ALERT ──────────────────────────────────────────
          if (stress > 0.60 && !isLookingAway) {
            showAlert("😰 You seem stressed — take a breath before answering")
          }

          // ── ENGAGEMENT SCORE ───────────────────────────────────────────
          const eyeScore = eyeContactScoreRef.current
          const postureScore = postureGood ? 100 : 50
          const warmthScore = clamp((expr.happy ?? 0) * 2) * 100
          const calmScore = clamp(1 - stress) * 100
          const engagementScore = Math.round(
            eyeScore * 0.35 +
            postureScore * 0.25 +
            warmthScore * 0.20 +
            calmScore * 0.20
          )

          // ── SNAPSHOT ───────────────────────────────────────────────────
          timelineRef.current.push({
            timestamp: Date.now(),
            stress,
            confidence,
            neutral,
          })

          setEmotions({
            stress, confidence, neutral,
            happy: expr.happy ?? 0,
            raw: expr,
            ready: true,
            error: null,
            faceDetected: true,
            eyeContact: !isLookingAway,
            eyeContactScore: Math.round(eyeContactScoreRef.current),
            postureGood,
            engagementScore,
            blinkRate,
            smileCount: smileCountRef.current,
            lookAwaySeconds: Math.round(totalLookAwaySecsRef.current),
            alert: null,
          })

        } else {
          // ── NO FACE DETECTED ───────────────────────────────────────────
          consecutiveLookAwayRef.current++
          if (consecutiveLookAwayRef.current === 24) {
            showAlert("📷 Can't see your face — move closer or improve lighting!")
          }
          // Gently decay values — don't snap to 0
          smoothStress.current = ema(smoothStress.current, 0.15, 0.05)
          smoothConfidence.current = ema(smoothConfidence.current, 0.40, 0.05)
          smoothNeutral.current = ema(smoothNeutral.current, 0.50, 0.05)
          setEmotions(s => ({
            ...s,
            stress: smoothStress.current,
            confidence: smoothConfidence.current,
            neutral: smoothNeutral.current,
            faceDetected: false,
          }))
        }
      } catch { /* silent — keep running */ }

      // ── SIMULATION FALLBACK (no face-api / offline) ────────────────────
    } else if (!faceapi && isRunningRef.current) {
      const elapsed = timelineRef.current.length
      const t = Date.now() / 3000
      // Simulate a typical interview arc: nervous start → settles → stronger end
      const stressBase = Math.max(0.08, 0.38 - elapsed * 0.0015)
      const confBase = Math.min(0.78, 0.32 + elapsed * 0.0015)

      smoothStress.current = ema(smoothStress.current, stressBase + 0.05 * Math.sin(t * 1.7), 0.12)
      smoothConfidence.current = ema(smoothConfidence.current, confBase + 0.04 * Math.cos(t * 1.1), 0.12)
      smoothNeutral.current = ema(smoothNeutral.current, Math.max(0, 1 - smoothStress.current - smoothConfidence.current * 0.5), 0.12)

      const stress = clamp(smoothStress.current)
      const confidence = clamp(smoothConfidence.current)
      const neutral = clamp(smoothNeutral.current)

      timelineRef.current.push({ timestamp: Date.now(), stress, confidence, neutral })
      setEmotions(s => ({
        ...s, stress, confidence, neutral,
        faceDetected: true,
        eyeContact: Math.random() > 0.12,
        eyeContactScore: Math.round(clamp(0.75 + 0.12 * Math.sin(t)) * 100),
        postureGood: Math.random() > 0.15,
        engagementScore: Math.round(clamp(0.70 + 0.15 * Math.sin(t * 0.8)) * 100),
        blinkRate: Math.round(14 + 4 * Math.sin(t)),
        smileCount: smileCountRef.current,
        lookAwaySeconds: Math.round(totalLookAwaySecsRef.current),
      }))
    }

    animFrameRef.current = requestAnimationFrame(analyzeFrame)
  }, [videoRef, showAlert])

  // ── Eye Aspect Ratio ────────────────────────────────────────────────────
  // EAR = (|p1-p5| + |p2-p4|) / (2 * |p0-p3|)  — standard formula
  function eyeAspectRatio(pts: { x: number; y: number }[]): number {
    if (pts.length < 6) return 0.3  // assume open
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
    const vertical1 = dist(pts[1], pts[5])
    const vertical2 = dist(pts[2], pts[4])
    const horizontal = dist(pts[0], pts[3])
    return horizontal > 0 ? (vertical1 + vertical2) / (2.0 * horizontal) : 0.3
  }

  // ── Controls ────────────────────────────────────────────────────────────
  const startAnalysis = useCallback(() => {
    isRunningRef.current = true
    timelineRef.current = []
    frameCountRef.current = 0
    smoothStress.current = 0.15
    smoothConfidence.current = 0.55
    smoothNeutral.current = 0.40
    eyeContactScoreRef.current = 100
    consecutiveLookAwayRef.current = 0
    lookAwayStartRef.current = null
    totalLookAwaySecsRef.current = 0
    smileCountRef.current = 0
    smileActiveRef.current = false
    blinkWindowRef.current = []
    eyeOpennessHistRef.current = []
    eyeXHistRef.current = []
    eyeYHistRef.current = []
    wasBlinkingRef.current = false
    alertCooldownRef.current = false
    baselineFaceSizeRef.current = 0
    baselineFramesRef.current = 0
    analyzeFrame()
  }, [analyzeFrame])

  const stopAnalysis = useCallback(() => {
    isRunningRef.current = false
    cancelAnimationFrame(animFrameRef.current)
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
  }, [])

  const getTimeline = useCallback(() => [...timelineRef.current], [])

  const getEmotionSummary = useCallback(() => {
    const tl = timelineRef.current
    if (!tl.length) return { stress: 0.15, confidence: 0.55, neutral: 0.4 }
    const avg = (key: keyof EmotionSnapshot) =>
      tl.reduce((s, snap) => s + (snap[key] as number), 0) / tl.length
    return {
      stress: avg('stress'),
      confidence: avg('confidence'),
      neutral: avg('neutral'),
      eyeContactScore: eyeContactScoreRef.current,
      smileCount: smileCountRef.current,
      lookAwaySeconds: totalLookAwaySecsRef.current,
    }
  }, [])

  useEffect(() => {
    loadModels()
    return () => stopAnalysis()
  }, [loadModels, stopAnalysis])

  return { emotions, startAnalysis, stopAnalysis, getTimeline, getEmotionSummary, showAlert }
}