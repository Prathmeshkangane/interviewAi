import { useState, useRef, useCallback, useEffect } from 'react'
import type { BodySignals, EmotionSnapshot } from '../lib/api'

// ── Tunables (thresholds are heuristics: tune them on your own webcam) ─────────
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model'
const MAX_TIMELINE_POINTS = 300       // timeline sent to the backend is downsampled to this
const MIN_FRAMES_FOR_SIGNALS = 16     // ~2s of analysed video before body signals count
const MIN_FACE_SECONDS_FOR_SUMMARY = 2
const BLINK_CLOSE = 0.24
const BLINK_OPEN = 0.28
const YAW_AWAY_THRESHOLD = 0.15       // nose offset from the jaw midline (0.5 = facing camera)
const OFF_FRAME_THRESHOLD = 0.30      // face centre this far from the frame centre = out of position
const MAX_CONSECUTIVE_ERRORS = 25

export interface EmotionState {
  stress: number           // 0-1
  confidence: number       // 0-1
  neutral: number          // 0-1
  happy: number            // 0-1
  raw: Record<string, number>
  ready: boolean           // face models finished loading
  available: boolean       // analysis can actually run (models loaded, no fatal error)
  error: string | null     // why analysis is unavailable
  faceDetected: boolean
  eyeContact: boolean
  eyeContactScore: number  // 0-100 smoothed (live display)
  postureGood: boolean
  engagementScore: number  // 0-100
  blinkRate: number        // blinks per minute (rolling 60s window)
  blinkCount: number       // blinks during this question
  smileCount: number       // smiles during this question
  lookAwaySeconds: number  // seconds looking away during this question
  alert: string | null
}

/** Whole-session summary. Every ratio is 0-1; counts are separate fields. */
export interface SessionEmotionSummary {
  available: boolean
  questionsAnalyzed: number
  stress: number
  confidence: number
  neutral: number
  eyeContact: number       // share of face-visible time the head faced the camera
  goodPosture: number
  smileCount: number
  lookAwaySeconds: number
}

export const EMPTY_EMOTION_SUMMARY: SessionEmotionSummary = {
  available: false, questionsAnalyzed: 0, stress: 0, confidence: 0, neutral: 0,
  eyeContact: 0, goodPosture: 0, smileCount: 0, lookAwaySeconds: 0,
}

// Time-weighted accumulators for one question (a "segment")
interface Segment {
  startedAt: number
  frames: number
  faceFrames: number
  faceSeconds: number
  eyeContactSeconds: number
  lookAwaySeconds: number
  postureGoodSeconds: number
  stressSum: number
  confidenceSum: number
  neutralSum: number
  blinks: number
  smiles: number
}

const newSegment = (): Segment => ({
  startedAt: Date.now(), frames: 0, faceFrames: 0, faceSeconds: 0, eyeContactSeconds: 0,
  lookAwaySeconds: 0, postureGoodSeconds: 0, stressSum: 0, confidenceSum: 0, neutralSum: 0,
  blinks: 0, smiles: 0,
})

function addSegment(total: Segment, seg: Segment) {
  total.frames += seg.frames
  total.faceFrames += seg.faceFrames
  total.faceSeconds += seg.faceSeconds
  total.eyeContactSeconds += seg.eyeContactSeconds
  total.lookAwaySeconds += seg.lookAwaySeconds
  total.postureGoodSeconds += seg.postureGoodSeconds
  total.stressSum += seg.stressSum
  total.confidenceSum += seg.confidenceSum
  total.neutralSum += seg.neutralSum
  total.blinks += seg.blinks
  total.smiles += seg.smiles
}

// ── Small pure helpers ─────────────────────────────────────────────────────────
type Pt = { x: number; y: number }

const ema = (prev: number, next: number, alpha = 0.15) => prev * (1 - alpha) + next * alpha
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function variance(arr: number[]): number {
  if (arr.length < 2) return 0
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
}

// EAR = (|p1-p5| + |p2-p4|) / (2 * |p0-p3|)
function eyeAspectRatio(pts: Pt[]): number {
  if (pts.length < 6) return 0.3
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
  const horizontal = dist(pts[0], pts[3])
  return horizontal > 0 ? (dist(pts[1], pts[5]) + dist(pts[2], pts[4])) / (2 * horizontal) : 0.3
}

/** Head yaw proxy from the 68 landmarks: where the nose tip sits between the jaw's left and
 *  right ends. ~0.5 when facing the camera; moves toward 0 or 1 as the head turns. */
export function headYawRatio(pts: Pt[]): number | null {
  if (pts.length < 68) return null
  const width = pts[16].x - pts[0].x
  if (width <= 0) return null
  return (pts[30].x - pts[0].x) / width
}

export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return [...items]
  const step = items.length / max
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)])
}

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useFaceAnalysis(videoRef: { readonly current: HTMLVideoElement | null }) {
  const [emotions, setEmotions] = useState<EmotionState>({
    stress: 0.15, confidence: 0.55, neutral: 0.4, happy: 0,
    raw: {}, ready: false, available: false, error: null, faceDetected: false,
    eyeContact: true, eyeContactScore: 100, postureGood: true,
    engagementScore: 80, blinkRate: 0, blinkCount: 0, smileCount: 0,
    lookAwaySeconds: 0, alert: null,
  })

  const timelineRef = useRef<EmotionSnapshot[]>([])
  const animFrameRef = useRef<number>(0)
  const faceApiRef = useRef<any>(null)
  const isRunningRef = useRef(false)
  const unavailableRef = useRef(false)     // models failed to load / detection keeps failing
  const frameCountRef = useRef(0)
  const detectErrorsRef = useRef(0)
  const lastFrameTimeRef = useRef(0)

  // Smoothed values (separate from display state to avoid jitter)
  const smoothStress = useRef(0.15)
  const smoothConfidence = useRef(0.55)
  const smoothNeutral = useRef(0.4)

  // Blinks
  const blinkWindowRef = useRef<number[]>([])
  const eyeOpennessHistRef = useRef<number[]>([])
  const wasBlinkingRef = useRef(false)
  const questionBlinkCountRef = useRef(0)

  // Eye movement variability (proxy for anxious scanning)
  const eyeXHistRef = useRef<number[]>([])
  const eyeYHistRef = useRef<number[]>([])

  // Posture baseline: built once per session (first 10 faces) so it is not re-learned per question
  const baselineFaceSizeRef = useRef(0)
  const baselineFramesRef = useRef(0)

  // Eye contact / looking away
  const eyeContactScoreRef = useRef(100)
  const consecutiveLookAwayRef = useRef(0)
  const noFaceFramesRef = useRef(0)

  // Alerts
  const alertCooldownRef = useRef(false)
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Smile
  const smileActiveRef = useRef(false)

  // Accumulators: current question + whole session
  const segRef = useRef<Segment>(newSegment())
  const segEndRef = useRef(Date.now())
  const segmentOpenRef = useRef(false)
  const totalsRef = useRef<Segment>(newSegment())
  const questionsAnalyzedRef = useRef(0)

  // ── Load models ─────────────────────────────────────────────────────────────
  const loadModels = useCallback(async () => {
    try {
      const faceapi = await import('face-api.js')
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      ])
      faceApiRef.current = faceapi
      setEmotions(s => ({ ...s, ready: true, available: true, error: null }))
    } catch (err) {
      // No fake data: tell the user, and let the rest of the app run without body analysis.
      console.warn('face-api.js models failed to load:', err)
      unavailableRef.current = true
      setEmotions(s => ({
        ...s, ready: true, available: false,
        error: 'Face models could not be loaded (check your internet connection).',
      }))
    }
  }, [])

  // ── Alerts ──────────────────────────────────────────────────────────────────
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

  // ── One analysed frame ──────────────────────────────────────────────────────
  const analyzeFrame = useCallback(async () => {
    if (!isRunningRef.current) return
    const schedule = () => {
      if (isRunningRef.current) animFrameRef.current = requestAnimationFrame(analyzeFrame)
    }

    frameCountRef.current++
    if (frameCountRef.current % 4 !== 0) { schedule(); return }   // analyse every 4th frame

    const faceapi = faceApiRef.current
    if (!faceapi) {                       // models still loading: wait, unless loading failed
      if (!unavailableRef.current) schedule()
      return
    }
    const video = videoRef.current
    if (!video || video.readyState < 2 || video.videoWidth === 0) { schedule(); return }

    const nowMs = performance.now()
    const dt = lastFrameTimeRef.current ? Math.min((nowMs - lastFrameTimeRef.current) / 1000, 1) : 0
    lastFrameTimeRef.current = nowMs
    const seg = segRef.current
    seg.frames++

    let detection: any
    try {
      detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 }))
        .withFaceLandmarks(true)
        .withFaceExpressions()
      detectErrorsRef.current = 0
    } catch (err) {
      detectErrorsRef.current++
      if (detectErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
        console.warn('Face detection keeps failing, giving up:', err)
        unavailableRef.current = true
        setEmotions(s => ({ ...s, available: false, error: 'Face analysis stopped working in this browser.' }))
        return
      }
      schedule()
      return
    }
    if (!isRunningRef.current) return     // stopped while detection was running

    if (!detection) {
      // ── No face in frame ───────────────────────────────────────────────────
      noFaceFramesRef.current++
      if (noFaceFramesRef.current === 24) {
        showAlert("📷 Can't see your face — move closer or improve lighting!")
      }
      smoothStress.current = ema(smoothStress.current, 0.15, 0.05)
      smoothConfidence.current = ema(smoothConfidence.current, 0.4, 0.05)
      smoothNeutral.current = ema(smoothNeutral.current, 0.5, 0.05)
      setEmotions(s => ({
        ...s,
        stress: smoothStress.current,
        confidence: smoothConfidence.current,
        neutral: smoothNeutral.current,
        faceDetected: false,
        blinkCount: questionBlinkCountRef.current,
      }))
      schedule()
      return
    }
    noFaceFramesRef.current = 0

    const expr = detection.expressions as Record<string, number>
    const box = detection.detection.box
    const lms = detection.landmarks
    const videoW = video.videoWidth
    const videoH = video.videoHeight

    // ── Posture: face size vs the session baseline ────────────────────────────
    const faceSize = box.width * box.height
    if (baselineFramesRef.current < 10) {
      baselineFaceSizeRef.current =
        (baselineFaceSizeRef.current * baselineFramesRef.current + faceSize) / (baselineFramesRef.current + 1)
      baselineFramesRef.current++
    }
    const sizeRatio = baselineFaceSizeRef.current > 0 ? faceSize / baselineFaceSizeRef.current : 1
    const postureGood = sizeRatio > 0.6
    if (!postureGood) showAlert('📐 Sit up straight — good posture signals confidence!')

    // ── Eye landmarks ─────────────────────────────────────────────────────────
    const leftEye: Pt[] = lms.getLeftEye()
    const rightEye: Pt[] = lms.getRightEye()
    const eyeMidX = (leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length +
      rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length) / 2
    const eyeMidY = (leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length +
      rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length) / 2
    const eyeNormX = eyeMidX / videoW
    const eyeNormY = eyeMidY / videoH

    // ── Looking at the camera? ────────────────────────────────────────────────
    // Head direction (nose vs jaw) is far closer to "facing the camera" than where the face
    // sits in the frame. Position only catches a face that has left the frame.
    const yaw = headYawRatio(lms.positions as Pt[])
    const headTurned = yaw !== null && Math.abs(yaw - 0.5) > YAW_AWAY_THRESHOLD
    const faceCenterX = (box.x + box.width / 2) / videoW
    const faceCenterY = (box.y + box.height / 2) / videoH
    const outOfPosition =
      Math.abs(faceCenterX - 0.5) > OFF_FRAME_THRESHOLD || Math.abs(faceCenterY - 0.45) > OFF_FRAME_THRESHOLD
    const isLookingAway = headTurned || outOfPosition

    if (isLookingAway) {
      consecutiveLookAwayRef.current++
      if (consecutiveLookAwayRef.current === 16) {
        showAlert('👁️ Look at the camera — eye contact is critical in interviews!')
      }
    } else {
      consecutiveLookAwayRef.current = 0
    }
    eyeContactScoreRef.current = ema(eyeContactScoreRef.current, isLookingAway ? 0 : 100, 0.08)

    // ── Eye movement variability ──────────────────────────────────────────────
    eyeXHistRef.current.push(eyeNormX)
    eyeYHistRef.current.push(eyeNormY)
    if (eyeXHistRef.current.length > 30) eyeXHistRef.current.shift()
    if (eyeYHistRef.current.length > 30) eyeYHistRef.current.shift()
    const eyeVariability = Math.sqrt(variance(eyeXHistRef.current) + variance(eyeYHistRef.current))

    // ── Blinks ────────────────────────────────────────────────────────────────
    const avgEAR = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2
    eyeOpennessHistRef.current.push(avgEAR)
    if (eyeOpennessHistRef.current.length > 4) eyeOpennessHistRef.current.shift()
    const smoothedEAR = eyeOpennessHistRef.current.reduce((s, v) => s + v, 0) / eyeOpennessHistRef.current.length

    if (smoothedEAR < BLINK_CLOSE && !wasBlinkingRef.current) {
      wasBlinkingRef.current = true
      blinkWindowRef.current.push(Date.now())
      questionBlinkCountRef.current++
      seg.blinks++
    }
    if (smoothedEAR > BLINK_OPEN) wasBlinkingRef.current = false

    const now60 = Date.now()
    blinkWindowRef.current = blinkWindowRef.current.filter(t => now60 - t < 60000)
    const blinkRate = blinkWindowRef.current.length
    const blinkStressSignal = blinkRate > 25
      ? (blinkRate - 25) / 25
      : blinkRate < 8 && blinkWindowRef.current.length >= 5 ? (8 - blinkRate) / 8 : 0

    // ── Smile ─────────────────────────────────────────────────────────────────
    const isSmiling = (expr.happy ?? 0) > 0.45
    if (isSmiling && !smileActiveRef.current) {
      seg.smiles++
      smileActiveRef.current = true
    } else if (!isSmiling) {
      smileActiveRef.current = false
    }

    // ── Stress (heuristic blend of expression, blink and gaze signals) ────────
    const sadSignal = expr.sad ?? 0
    const surprisedSignal = (expr.surprised ?? 0) * 0.6
    const fearSignal = (expr.fearful ?? 0) * 0.4
    const noSmileSignal = clamp01(1 - (expr.happy ?? 0) * 2) * 0.3
    const blinkSignal = clamp01(blinkStressSignal) * 0.4
    const eyeVarSignal = clamp01(eyeVariability / 0.025) * 0.35
    const lookAwaySignal = isLookingAway ? 0.2 : 0
    const rawStress = clamp01(
      sadSignal * 0.30 + surprisedSignal * 0.15 + fearSignal * 0.10 + noSmileSignal * 0.15 +
      blinkSignal * 0.15 + eyeVarSignal * 0.10 + lookAwaySignal * 0.05
    )

    // ── Confidence ────────────────────────────────────────────────────────────
    const eyeContact01 = clamp01(eyeContactScoreRef.current / 100)
    const steadyEyes = clamp01(1 - eyeVarSignal / 0.35)
    const calmBlinks = blinkRate >= 8 && blinkRate <= 25 ? 1.0 : 0.5
    const rawConfidence = clamp01(
      (expr.happy ?? 0) * 0.30 + (expr.neutral ?? 0) * 0.6 * 0.20 + eyeContact01 * 0.25 +
      steadyEyes * 0.15 + calmBlinks * 0.10
    )

    const rawNeutral = clamp01(
      (expr.neutral ?? 0) * 0.7 + (1 - rawStress) * 0.2 + (1 - Math.abs(rawConfidence - 0.5)) * 0.1
    )

    smoothStress.current = ema(smoothStress.current, rawStress, 0.12)
    smoothConfidence.current = ema(smoothConfidence.current, rawConfidence, 0.12)
    smoothNeutral.current = ema(smoothNeutral.current, rawNeutral, 0.12)
    const stress = smoothStress.current
    const confidence = smoothConfidence.current
    const neutral = smoothNeutral.current

    if (stress > 0.6 && !isLookingAway) showAlert('😰 You seem stressed — take a breath before answering')

    const engagementScore = Math.round(
      eyeContactScoreRef.current * 0.35 + (postureGood ? 100 : 50) * 0.25 +
      clamp01((expr.happy ?? 0) * 2) * 100 * 0.2 + clamp01(1 - stress) * 100 * 0.2
    )

    // ── Accumulate for the per-question signals and the session summary ───────
    seg.faceFrames++
    seg.faceSeconds += dt
    if (isLookingAway) seg.lookAwaySeconds += dt
    else seg.eyeContactSeconds += dt
    if (postureGood) seg.postureGoodSeconds += dt
    seg.stressSum += stress * dt
    seg.confidenceSum += confidence * dt
    seg.neutralSum += neutral * dt

    timelineRef.current.push({ timestamp: Date.now(), stress, confidence, neutral })

    setEmotions({
      stress, confidence, neutral,
      happy: expr.happy ?? 0,
      raw: expr,
      ready: true,
      available: true,
      error: null,
      faceDetected: true,
      eyeContact: !isLookingAway,
      eyeContactScore: Math.round(eyeContactScoreRef.current),
      postureGood,
      engagementScore,
      blinkRate,
      blinkCount: questionBlinkCountRef.current,
      smileCount: seg.smiles,
      lookAwaySeconds: Math.round(seg.lookAwaySeconds),
      alert: null,
    })

    schedule()
  }, [videoRef, showAlert])

  // ── Segment bookkeeping ─────────────────────────────────────────────────────
  const finalizeSegment = useCallback(() => {
    if (!segmentOpenRef.current) return
    segmentOpenRef.current = false
    segEndRef.current = Date.now()
    addSegment(totalsRef.current, segRef.current)
    if (segRef.current.faceFrames > 0) questionsAnalyzedRef.current++
  }, [])

  // ── Controls ────────────────────────────────────────────────────────────────
  const startAnalysis = useCallback(() => {
    if (isRunningRef.current) return
    finalizeSegment()
    segRef.current = newSegment()
    segmentOpenRef.current = true

    isRunningRef.current = true
    timelineRef.current = []
    frameCountRef.current = 0
    detectErrorsRef.current = 0
    lastFrameTimeRef.current = 0
    smoothStress.current = 0.15
    smoothConfidence.current = 0.55
    smoothNeutral.current = 0.4
    eyeContactScoreRef.current = 100
    consecutiveLookAwayRef.current = 0
    noFaceFramesRef.current = 0
    smileActiveRef.current = false
    blinkWindowRef.current = []
    eyeOpennessHistRef.current = []
    eyeXHistRef.current = []
    eyeYHistRef.current = []
    wasBlinkingRef.current = false
    questionBlinkCountRef.current = 0
    alertCooldownRef.current = false
    setEmotions(s => ({ ...s, smileCount: 0, lookAwaySeconds: 0, blinkCount: 0, alert: null }))
    analyzeFrame()
  }, [analyzeFrame, finalizeSegment])

  // Safe to call repeatedly; the question's data is folded into the session totals once.
  const stopAnalysis = useCallback(() => {
    isRunningRef.current = false
    cancelAnimationFrame(animFrameRef.current)
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current)
    finalizeSegment()
  }, [finalizeSegment])

  /** Downsampled emotion timeline for the current question (feeds the confidence trend). */
  const getTimeline = useCallback(
    () => downsample(timelineRef.current, MAX_TIMELINE_POINTS), []
  )

  /** Real webcam signals for the current question; `available: false` if they can't be trusted. */
  const getBodySignals = useCallback((durationSeconds?: number): BodySignals => {
    const s = segRef.current
    const end = segmentOpenRef.current ? Date.now() : segEndRef.current
    const analysedSeconds = Math.max(0, (end - s.startedAt) / 1000)
    const faceSecs = s.faceSeconds
    const available =
      !unavailableRef.current && faceApiRef.current !== null && s.frames >= MIN_FRAMES_FOR_SIGNALS
    return {
      available,
      frames_analyzed: s.frames,
      face_detected_ratio: s.frames > 0 ? s.faceFrames / s.frames : 0,
      eye_contact_pct: faceSecs > 0 ? Math.min(100, (100 * s.eyeContactSeconds) / faceSecs) : 0,
      look_away_seconds: s.lookAwaySeconds,
      posture_good_ratio: faceSecs > 0 ? Math.min(1, s.postureGoodSeconds / faceSecs) : 0,
      smile_count: s.smiles,
      blink_rate_per_min: faceSecs > 0 ? s.blinks / (faceSecs / 60) : 0,
      avg_stress: faceSecs > 0 ? clamp01(s.stressSum / faceSecs) : 0,
      duration_seconds: durationSeconds ?? analysedSeconds,
    }
  }, [])

  /** Summary across ALL questions, with every ratio in 0-1 (counts are separate fields). */
  const getEmotionSummary = useCallback((): SessionEmotionSummary => {
    const t = { ...totalsRef.current }
    if (segmentOpenRef.current) addSegment(t, segRef.current)
    const secs = t.faceSeconds
    if (unavailableRef.current || secs < MIN_FACE_SECONDS_FOR_SUMMARY) return EMPTY_EMOTION_SUMMARY
    return {
      available: true,
      questionsAnalyzed: questionsAnalyzedRef.current + (segmentOpenRef.current && segRef.current.faceFrames > 0 ? 1 : 0),
      stress: clamp01(t.stressSum / secs),
      confidence: clamp01(t.confidenceSum / secs),
      neutral: clamp01(t.neutralSum / secs),
      eyeContact: clamp01(t.eyeContactSeconds / secs),
      goodPosture: clamp01(t.postureGoodSeconds / secs),
      smileCount: t.smiles,
      lookAwaySeconds: Math.round(t.lookAwaySeconds),
    }
  }, [])

  useEffect(() => {
    loadModels()
    return () => stopAnalysis()
  }, [loadModels, stopAnalysis])

  return { emotions, startAnalysis, stopAnalysis, getTimeline, getBodySignals, getEmotionSummary, showAlert }
}