import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as THREE from 'three'

export interface InterviewerAvatarHandle {
  speak: (text: string, onEnd?: () => void) => void
  stopSpeaking: () => void
}

interface Props {
  questionText: string
  questionNumber: number
  totalQuestions: number
  phase: 'ready' | 'recording' | 'analyzing' | 'reviewed'
}

// ── Detect gender from chosen TTS voice ──────────────────────────────────────
function detectVoiceGender(voice: SpeechSynthesisVoice | null): 'male' | 'female' {
  if (!voice) return 'male'
  const name = voice.name.toLowerCase()
  const femaleKeywords = [
    'female', 'woman', 'girl', 'samantha', 'victoria', 'karen', 'moira',
    'fiona', 'tessa', 'veena', 'zira', 'susan', 'helen', 'hazel', 'eva',
    'google uk english female', 'microsoft zira', 'alice', 'amelie',
  ]
  const maleKeywords = [
    'male', 'man', 'daniel', 'alex', 'fred', 'arthur', 'george', 'james',
    'google uk english male', 'microsoft david', 'microsoft mark',
  ]
  if (femaleKeywords.some(k => name.includes(k))) return 'female'
  if (maleKeywords.some(k => name.includes(k))) return 'male'
  return 'male'
}

// ── Pick best voice & return it ───────────────────────────────────────────────
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find(v =>
      v.lang.startsWith('en') && (
        v.name.includes('Daniel') || v.name.includes('Google UK English Male') ||
        v.name.includes('Alex') || v.name.includes('Fred') || v.name.includes('Arthur')
      )
    ) ||
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang === 'en-US') ||
    voices[0] ||
    null
  )
}

// ── Build the 3D scene for a given gender ────────────────────────────────────
function buildScene(
  canvas: HTMLCanvasElement,
  gender: 'male' | 'female',
  mouthRef: React.MutableRefObject<THREE.Mesh | null>,
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>
) {
  const W = canvas.clientWidth || 240
  const H = canvas.clientHeight || 240

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x06060f, 0.22)

  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 50)
  camera.position.set(0, 0.15, 2.5)
  camera.lookAt(0, 0.1, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(W, H)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  rendererRef.current = renderer

  // ── Lighting ─────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  const key = new THREE.DirectionalLight(0xe8f4ff, 2.4)
  key.position.set(-1.5, 2.5, 3); key.castShadow = true; scene.add(key)
  const fill = new THREE.DirectionalLight(gender === 'female' ? 0xff80c0 : 0x7c3aed, 0.55)
  fill.position.set(3, 0, -1); scene.add(fill)
  const top = new THREE.DirectionalLight(0xffffff, 0.7)
  top.position.set(0, 4, 1); scene.add(top)
  const rim = new THREE.DirectionalLight(gender === 'female' ? 0xff99cc : 0x00d4ff, 0.4)
  rim.position.set(0, -1.5, -3); scene.add(rim)

  // ── Materials ─────────────────────────────────────────────────────────────
  // Skin tone — slightly lighter for female
  const skinColor = gender === 'female' ? 0xe8b090 : 0xd4956a
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.45, metalness: 0 })

  // Outfit — blazer for male, blouse for female
  const outfitColor = gender === 'female' ? 0x1a0a2e : 0x0f172a
  const outfit = new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.28, metalness: 0.5 })

  const shirt = new THREE.MeshStandardMaterial({ color: 0xf8faff, roughness: 0.90 })

  // Accent — tie for male, scarf detail for female
  const accentColor = gender === 'female' ? 0xc026d3 : 0x7c3aed
  const accent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.25 })

  const iris = new THREE.MeshStandardMaterial({
    color: gender === 'female' ? 0x2d4a7a : 0x1e3a5f,
    roughness: 0.12, metalness: 0.8
  })
  const pupil = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.10, metalness: 0.9 })
  const white = new THREE.MeshStandardMaterial({ color: 0xfbfcff, roughness: 0.95 })

  // Hair — dark brown for male, darker with volume for female
  const hairColor = gender === 'female' ? 0x0d0604 : 0x1c0f00
  const hair = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.90 })
  const lip = new THREE.MeshStandardMaterial({
    color: gender === 'female' ? 0xb03060 : 0x6b2d1a,
    roughness: 0.60
  })
  const brow = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.95 })
  const shine = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0, metalness: 1 })

  const g = new THREE.Group()
  scene.add(g)

  const mk = (
    geo: THREE.BufferGeometry, mat: THREE.Material,
    px = 0, py = 0, pz = 0,
    rx = 0, ry = 0, rz = 0,
    sx = 1, sy = 1, sz = 1
  ) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(px, py, pz)
    m.rotation.set(rx, ry, rz)
    m.scale.set(sx, sy, sz)
    m.castShadow = true
    g.add(m)
    return m
  }

  // ── Body / Torso ──────────────────────────────────────────────────────────
  if (gender === 'male') {
    mk(new THREE.CylinderGeometry(0.210, 0.280, 0.52, 24), outfit, 0, -0.43, 0)
    mk(new THREE.PlaneGeometry(0.13, 0.32), shirt, 0, -0.33, 0.225)
    // Tie
    mk(new THREE.BoxGeometry(0.050, 0.26, 0.018), accent, 0, -0.34, 0.233)
    // Lapels
    mk(new THREE.BoxGeometry(0.100, 0.28, 0.040), outfit, -0.060, -0.30, 0.210, 0, 0, 0.26)
    mk(new THREE.BoxGeometry(0.100, 0.28, 0.040), outfit, 0.060, -0.30, 0.210, 0, 0, -0.26)
    // Shoulders
    mk(new THREE.SphereGeometry(0.130, 18, 14), outfit, -0.310, -0.215, 0)
    mk(new THREE.SphereGeometry(0.130, 18, 14), outfit, 0.310, -0.215, 0)
    // Upper arms
    mk(new THREE.CylinderGeometry(0.070, 0.070, 0.26, 16), outfit, -0.312, -0.375, 0, 0, 0, 0.17)
    mk(new THREE.CylinderGeometry(0.070, 0.070, 0.26, 16), outfit, 0.312, -0.375, 0, 0, 0, -0.17)
  } else {
    // Female — fitted blazer, more tapered
    mk(new THREE.CylinderGeometry(0.185, 0.255, 0.50, 24), outfit, 0, -0.43, 0)
    mk(new THREE.PlaneGeometry(0.11, 0.28), shirt, 0, -0.33, 0.222)
    // Blouse detail
    mk(new THREE.BoxGeometry(0.036, 0.20, 0.016), accent, 0, -0.30, 0.232)
    // Lapels — narrower for female
    mk(new THREE.BoxGeometry(0.080, 0.24, 0.036), outfit, -0.048, -0.28, 0.208, 0, 0, 0.22)
    mk(new THREE.BoxGeometry(0.080, 0.24, 0.036), outfit, 0.048, -0.28, 0.208, 0, 0, -0.22)
    // Shoulders — softer
    mk(new THREE.SphereGeometry(0.115, 18, 14), outfit, -0.290, -0.215, 0)
    mk(new THREE.SphereGeometry(0.115, 18, 14), outfit, 0.290, -0.215, 0)
    mk(new THREE.CylinderGeometry(0.062, 0.062, 0.24, 16), outfit, -0.296, -0.375, 0, 0, 0, 0.17)
    mk(new THREE.CylinderGeometry(0.062, 0.062, 0.24, 16), outfit, 0.296, -0.375, 0, 0, 0, -0.17)
  }

  // ── Neck ─────────────────────────────────────────────────────────────────
  const neckW = gender === 'female' ? 0.048 : 0.056
  mk(new THREE.CylinderGeometry(neckW, neckW + 0.010, 0.130, 18), skin, 0, -0.048, 0)

  // ── Head ─────────────────────────────────────────────────────────────────
  // Female head slightly narrower and more oval
  const headSX = gender === 'female' ? 0.96 : 1.0
  const headSY = gender === 'female' ? 1.14 : 1.10
  const headSZ = gender === 'female' ? 0.90 : 0.91
  const head = mk(new THREE.SphereGeometry(0.215, 32, 26), skin, 0, 0.240, 0)
  head.scale.set(headSX, headSY, headSZ)

  // ── Jawline / Chin ────────────────────────────────────────────────────────
  if (gender === 'male') {
    // Stronger, squarer jaw
    mk(new THREE.SphereGeometry(0.068, 12, 8), skin, 0, 0.090, 0.135, 0, 0, 0, 1.3, 0.6, 0.80)
    mk(new THREE.SphereGeometry(0.045, 10, 8), skin, -0.140, 0.100, 0.050, 0, 0, 0, 0.8, 0.7, 0.6)
    mk(new THREE.SphereGeometry(0.045, 10, 8), skin, 0.140, 0.100, 0.050, 0, 0, 0, 0.8, 0.7, 0.6)
  } else {
    // Softer chin
    mk(new THREE.SphereGeometry(0.055, 12, 8), skin, 0, 0.096, 0.140, 0, 0, 0, 1, 0.65, 0.78)
  }

  // ── Hair ─────────────────────────────────────────────────────────────────
  if (gender === 'male') {
    // Short, neat hair
    mk(new THREE.SphereGeometry(0.220, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.44), hair, 0, 0.292, -0.018)
    mk(new THREE.SphereGeometry(0.100, 14, 10), hair, -0.175, 0.265, -0.060)
    mk(new THREE.SphereGeometry(0.100, 14, 10), hair, 0.175, 0.265, -0.060)
    mk(new THREE.SphereGeometry(0.062, 10, 8), hair, -0.10, 0.338, 0.105)
    mk(new THREE.SphereGeometry(0.062, 10, 8), hair, 0.10, 0.338, 0.105)
    mk(new THREE.SphereGeometry(0.055, 10, 8), hair, 0, 0.350, 0.070)
  } else {
    // Longer, voluminous hair — extends below head
    // Crown
    mk(new THREE.SphereGeometry(0.228, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.50), hair, 0, 0.300, -0.020)
    // Side volumes — longer and lower
    mk(new THREE.SphereGeometry(0.130, 16, 12), hair, -0.195, 0.200, -0.055)
    mk(new THREE.SphereGeometry(0.130, 16, 12), hair, 0.195, 0.200, -0.055)
    // Lower hair extending down
    mk(new THREE.SphereGeometry(0.105, 14, 10), hair, -0.205, 0.050, -0.040)
    mk(new THREE.SphereGeometry(0.105, 14, 10), hair, 0.205, 0.050, -0.040)
    // Back bulk
    mk(new THREE.SphereGeometry(0.175, 18, 12), hair, 0, 0.140, -0.155)
    mk(new THREE.SphereGeometry(0.120, 14, 10), hair, 0, 0.000, -0.145)
    // Fringe / bangs
    mk(new THREE.SphereGeometry(0.075, 10, 8), hair, -0.100, 0.355, 0.100)
    mk(new THREE.SphereGeometry(0.075, 10, 8), hair, 0.100, 0.355, 0.100)
    mk(new THREE.SphereGeometry(0.065, 10, 8), hair, 0, 0.365, 0.085)
  }

  // ── Ears ─────────────────────────────────────────────────────────────────
  const earScale = gender === 'female' ? 0.032 : 0.037
  mk(new THREE.SphereGeometry(earScale, 10, 8), skin, -0.212, 0.228, 0, 0, 0, 0, 1, 1.28, 0.52)
  mk(new THREE.SphereGeometry(earScale, 10, 8), skin, 0.212, 0.228, 0, 0, 0, 0, 1, 1.28, 0.52)

  // Small earrings for female
  if (gender === 'female') {
    const earring = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.1, metalness: 0.95 })
    mk(new THREE.SphereGeometry(0.010, 8, 6), earring, -0.218, 0.195, 0)
    mk(new THREE.SphereGeometry(0.010, 8, 6), earring, 0.218, 0.195, 0)
  }

  // ── Eyes ─────────────────────────────────────────────────────────────────
  const eyeSpread = gender === 'female' ? 0.075 : 0.082
  const eyeY = gender === 'female' ? 0.270 : 0.265
  const eyeZ = 0.186
  // Whites
  mk(new THREE.SphereGeometry(0.040, 16, 12), white, -eyeSpread, eyeY, eyeZ)
  mk(new THREE.SphereGeometry(0.040, 16, 12), white, eyeSpread, eyeY, eyeZ)
  // Irises
  mk(new THREE.SphereGeometry(0.027, 14, 12), iris, -eyeSpread, eyeY, eyeZ + 0.010)
  mk(new THREE.SphereGeometry(0.027, 14, 12), iris, eyeSpread, eyeY, eyeZ + 0.010)
  // Pupils
  mk(new THREE.SphereGeometry(0.015, 12, 10), pupil, -eyeSpread, eyeY, eyeZ + 0.018)
  mk(new THREE.SphereGeometry(0.015, 12, 10), pupil, eyeSpread, eyeY, eyeZ + 0.018)
  // Shine
  mk(new THREE.SphereGeometry(0.007, 6, 6), shine, -eyeSpread + 0.007, eyeY + 0.007, eyeZ + 0.022)
  mk(new THREE.SphereGeometry(0.007, 6, 6), shine, eyeSpread + 0.007, eyeY + 0.007, eyeZ + 0.022)

  // Eyelids (upper) — thicker and more curved for female
  if (gender === 'female') {
    const lid = new THREE.MeshStandardMaterial({ color: 0x1a0530, roughness: 0.7 })
    mk(new THREE.BoxGeometry(0.085, 0.012, 0.010), lid, -eyeSpread, eyeY + 0.030, eyeZ + 0.008, 0, 0, -0.05)
    mk(new THREE.BoxGeometry(0.085, 0.012, 0.010), lid, eyeSpread, eyeY + 0.030, eyeZ + 0.008, 0, 0, 0.05)
  }

  // ── Eyebrows ─────────────────────────────────────────────────────────────
  const browY = gender === 'female' ? eyeY + 0.052 : eyeY + 0.050
  const browThick = gender === 'female' ? 0.010 : 0.014
  mk(new THREE.BoxGeometry(gender === 'female' ? 0.072 : 0.070, browThick, 0.011), brow, -eyeSpread, browY, eyeZ - 0.005, 0, 0, -0.08)
  mk(new THREE.BoxGeometry(gender === 'female' ? 0.072 : 0.070, browThick, 0.011), brow, eyeSpread, browY, eyeZ - 0.005, 0, 0, 0.08)

  // ── Nose ─────────────────────────────────────────────────────────────────
  const noseSize = gender === 'female' ? 0.019 : 0.022
  mk(new THREE.SphereGeometry(noseSize, 12, 10), skin, 0, 0.215, 0.210)
  mk(new THREE.SphereGeometry(0.010, 8, 6), skin, -0.017, 0.203, 0.206)
  mk(new THREE.SphereGeometry(0.010, 8, 6), skin, 0.017, 0.203, 0.206)

  // ── Mouth ─────────────────────────────────────────────────────────────────
  const mouthW = gender === 'female' ? 0.080 : 0.086
  const mouthY = gender === 'female' ? 0.178 : 0.176
  // Upper lip
  mk(new THREE.BoxGeometry(mouthW, 0.013, 0.010), lip, 0, mouthY + 0.013, 0.206)
  // Cupid bow dip for female
  if (gender === 'female') {
    mk(new THREE.SphereGeometry(0.008, 8, 6), lip, 0, mouthY + 0.017, 0.208)
  }
  // Lower lip — animated
  const mouth = mk(new THREE.BoxGeometry(mouthW - 0.004, 0.016, 0.012), lip, 0, mouthY, 0.206)
  mouthRef.current = mouth
  // Corners
  mk(new THREE.SphereGeometry(0.009, 6, 6), lip, -(mouthW / 2), mouthY + 0.006, 0.204)
  mk(new THREE.SphereGeometry(0.009, 6, 6), lip, (mouthW / 2), mouthY + 0.006, 0.204)

  // ── Desk ─────────────────────────────────────────────────────────────────
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.7 })
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.025, 0.8), deskMat)
  desk.position.set(0, -0.78, 0.2)
  desk.receiveShadow = true
  scene.add(desk)

  // ── Background ───────────────────────────────────────────────────────────
  const glowGeo = new THREE.PlaneGeometry(3, 3)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x060612, transparent: true, opacity: 0.95 })
  const glow = new THREE.Mesh(glowGeo, glowMat)
  glow.position.z = -1.5
  scene.add(glow)

  // Particles — female gets pink tint, male gets violet
  const pc = 70
  const pp = new Float32Array(pc * 3)
  for (let i = 0; i < pc; i++) {
    pp[i * 3] = (Math.random() - 0.5) * 5
    pp[i * 3 + 1] = (Math.random() - 0.5) * 4
    pp[i * 3 + 2] = (Math.random() - 0.5) * 2 - 1.5
  }
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3))
  scene.add(new THREE.Points(pGeo,
    new THREE.PointsMaterial({
      color: gender === 'female' ? 0xc026d3 : 0x7c3aed,
      size: 0.011, transparent: true, opacity: 0.28
    })
  ))

  return { scene, camera, renderer, g }
}

// ─────────────────────────────────────────────────────────────────────────────

export const InterviewerAvatar = forwardRef<InterviewerAvatarHandle, Props>(
  ({ questionText, questionNumber, totalQuestions, phase }, ref) => {

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const mouthRef = useRef<THREE.Mesh | null>(null)
    const animFrameRef = useRef<number>(0)
    const isSpeakingRef = useRef(false)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneGroupRef = useRef<THREE.Group | null>(null)

    const [isSpeaking, setIsSpeaking] = useState(false)
    const [hasSpoken, setHasSpoken] = useState(false)
    const [statusText, setStatusText] = useState('Click to hear question')
    const [gender, setGender] = useState<'male' | 'female'>('male')

    // ── 3D Scene setup ──────────────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      // Dispose previous renderer
      if (rendererRef.current) {
        rendererRef.current.dispose()
      }
      cancelAnimationFrame(animFrameRef.current)
      mouthRef.current = null

      const { scene, camera, renderer, g } = buildScene(canvas, gender, mouthRef, rendererRef)
      sceneGroupRef.current = g

      let t = 0
      const loop = () => {
        animFrameRef.current = requestAnimationFrame(loop)
        t += 0.016

        g.position.y = Math.sin(t * 0.70) * 0.006
        g.rotation.y = Math.sin(t * 0.25) * 0.038
        g.rotation.z = Math.sin(t * 0.40) * 0.009

        if (mouthRef.current) {
          const talking = isSpeakingRef.current
          const wantY = talking
            ? 0.012 + Math.abs(Math.sin(t * 10)) * 0.034
            : 0.016
          const wantZ = talking ? 0.022 : 0.012
          mouthRef.current.scale.y += (wantY / 0.016 - mouthRef.current.scale.y) * 0.20
          mouthRef.current.scale.z += (wantZ / 0.012 - mouthRef.current.scale.z) * 0.20
          mouthRef.current.position.y = (gender === 'female' ? 0.178 : 0.176) - (mouthRef.current.scale.y - 1) * 0.008
        }

        renderer.render(scene, camera)
      }
      loop()

      return () => {
        cancelAnimationFrame(animFrameRef.current)
        renderer.dispose()
        window.speechSynthesis?.cancel()
      }
    }, [gender]) // re-build scene when gender changes

    // ── TTS speak ───────────────────────────────────────────────────────────
    const speak = useCallback((text: string, onEnd?: () => void) => {
      if (!window.speechSynthesis) { onEnd?.(); return }
      window.speechSynthesis.cancel()

      setTimeout(() => {
        const utt = new SpeechSynthesisUtterance(text)
        utt.rate = 0.88
        utt.pitch = 0.95
        utt.volume = 1.0

        // Detect voice gender and update avatar BEFORE speaking
        const loadVoices = () => {
          const picked = pickVoice()
          const detectedGender = detectVoiceGender(picked)
          setGender(detectedGender)
          if (picked) utt.voice = picked
        }

        if (window.speechSynthesis.getVoices().length > 0) {
          loadVoices()
        } else {
          window.speechSynthesis.onvoiceschanged = loadVoices
        }

        utt.onstart = () => {
          isSpeakingRef.current = true
          setIsSpeaking(true)
          setStatusText('Asking question...')
        }
        utt.onend = () => {
          isSpeakingRef.current = false
          setIsSpeaking(false)
          setHasSpoken(true)
          setStatusText('Your turn — press Start Recording')
          onEnd?.()
        }
        utt.onerror = () => {
          isSpeakingRef.current = false
          setIsSpeaking(false)
          setHasSpoken(true)
          setStatusText('Your turn — press Start Recording')
          onEnd?.()
        }

        window.speechSynthesis.speak(utt)
      }, 400)
    }, [])

    const stopSpeaking = useCallback(() => {
      window.speechSynthesis?.cancel()
      isSpeakingRef.current = false
      setIsSpeaking(false)
      setHasSpoken(true)
      setStatusText('Your turn — press Start Recording')
    }, [])

    useImperativeHandle(ref, () => ({ speak, stopSpeaking }), [speak, stopSpeaking])

    useEffect(() => {
      setHasSpoken(false)
      setStatusText('Click to hear question')
    }, [questionText])

    useEffect(() => {
      if (phase === 'recording') setStatusText('Listening to your answer...')
      if (phase === 'analyzing') setStatusText('Analyzing your response...')
      if (phase === 'reviewed') setStatusText('Review feedback, then continue')
      if (phase === 'ready' && hasSpoken) setStatusText('Your turn — press Start Recording')
    }, [phase, hasSpoken])

    const isWaiting = phase === 'ready' && !isSpeaking
    const isListening = phase === 'recording'

    // Gender-themed accent color
    const accentColor = gender === 'female' ? '#c026d3' : '#7c3aed'
    const accentColorSoft = gender === 'female' ? 'rgba(192,38,211,0.35)' : 'rgba(124,58,237,0.35)'

    return (
      <div className="flex flex-col items-center">

        {/* Gender indicator badge — subtle top left */}
        <div className="relative w-full rounded-2xl overflow-hidden"
          style={{ background: 'radial-gradient(ellipse at center, #0d0d1f 0%, #06060f 100%)', aspectRatio: '1/1' }}>

          <canvas ref={canvasRef} className="w-full h-full" />

          {/* Speaking wave rings */}
          <AnimatePresence>
            {isSpeaking && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {[1, 2, 3].map(i => (
                  <motion.div key={i}
                    className="absolute rounded-full"
                    style={{ border: `1px solid ${accentColorSoft}`, width: `${40 + i * 22}%`, height: `${40 + i * 22}%` }}
                    animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.38 }}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>

          {/* Listening ring — green when recording */}
          <AnimatePresence>
            {isListening && (
              <motion.div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{ border: '2px solid rgba(0,255,136,0.5)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            )}
          </AnimatePresence>

          {/* Name badge */}
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(6,6,15,0.80)', backdropFilter: 'blur(10px)', border: `1px solid ${accentColorSoft}` }}>
              {isSpeaking && (
                <div className="flex gap-0.5 items-end h-3">
                  {[0, 1, 2, 1, 0].map((h, i) => (
                    <motion.div key={i} className="w-0.5 rounded-full"
                      style={{ background: accentColor }}
                      animate={{ height: [`${(h + 1) * 3}px`, `${(h + 1) * 3 + 6}px`, `${(h + 1) * 3}px`] }}
                      transition={{ duration: 0.45, repeat: Infinity, delay: i * 0.08 }} />
                  ))}
                </div>
              )}
              <span className="text-white/70 text-xs font-display tracking-wide">
                {isSpeaking ? 'Speaking' : isListening ? 'Listening' : 'Interviewer'}
              </span>
              {isListening && (
                <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }}
                  className="w-1.5 h-1.5 rounded-full bg-accent-green" />
              )}
            </div>
          </div>

          {/* Question number badge */}
          <div className="absolute top-3 right-3">
            <div className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold"
              style={{ background: `${accentColor}33`, color: gender === 'female' ? '#e879f9' : '#a78bfa', border: `1px solid ${accentColor}55` }}>
              Q{questionNumber}/{totalQuestions}
            </div>
          </div>

          {/* Gender label — very subtle top left */}
          <div className="absolute top-3 left-3">
            <div className="px-2 py-0.5 rounded-md text-xs font-display"
              style={{ background: 'rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.3)', backdropFilter: 'blur(4px)' }}>
              {gender === 'female' ? '♀ Female' : '♂ Male'}
            </div>
          </div>
        </div>

        {/* Status text */}
        <motion.p
          key={statusText}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-white/40 text-xs font-body text-center mt-2"
        >
          {statusText}
        </motion.p>
      </div>
    )
  })

InterviewerAvatar.displayName = 'InterviewerAvatar'