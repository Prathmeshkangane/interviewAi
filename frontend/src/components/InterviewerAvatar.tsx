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

export const InterviewerAvatar = forwardRef<InterviewerAvatarHandle, Props>(
  ({ questionText, questionNumber, totalQuestions, phase }, ref) => {

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const mouthRef = useRef<THREE.Mesh | null>(null)
    const animFrameRef = useRef<number>(0)
    const isSpeakingRef = useRef(false)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)

    const [isSpeaking, setIsSpeaking] = useState(false)
    const [hasSpoken, setHasSpoken] = useState(false)
    const [statusText, setStatusText] = useState('Click to hear question')

    // ── 3D Scene ────────────────────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
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

      // Lighting — professional interview panel vibe
      scene.add(new THREE.AmbientLight(0xffffff, 0.30))

      const key = new THREE.DirectionalLight(0xe8f4ff, 2.2)
      key.position.set(-1.5, 2.5, 3); key.castShadow = true; scene.add(key)

      const fill = new THREE.DirectionalLight(0x7c3aed, 0.7)
      fill.position.set(3, 0, -1); scene.add(fill)

      const top = new THREE.DirectionalLight(0xffffff, 0.6)
      top.position.set(0, 4, 1); scene.add(top)

      const rim = new THREE.DirectionalLight(0x00d4ff, 0.35)
      rim.position.set(0, -1.5, -3); scene.add(rim)

      // Materials
      const skin = new THREE.MeshStandardMaterial({ color: 0xd4956a, roughness: 0.50, metalness: 0 })
      const suit = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.30, metalness: 0.5 })
      const shirt = new THREE.MeshStandardMaterial({ color: 0xf8faff, roughness: 0.90 })
      const tie = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.40, metalness: 0.2 })
      const iris = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.15, metalness: 0.8 })
      const pupil = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.10, metalness: 0.9 })
      const white = new THREE.MeshStandardMaterial({ color: 0xfbfcff, roughness: 0.95 })
      const hair = new THREE.MeshStandardMaterial({ color: 0x1c0f00, roughness: 0.92 })
      const lip = new THREE.MeshStandardMaterial({ color: 0x6b2d1a, roughness: 0.65 })
      const brow = new THREE.MeshStandardMaterial({ color: 0x1c0f00, roughness: 0.95 })

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

      // ── Body ────────────────────────────────────────────────────────────
      // Torso
      mk(new THREE.CylinderGeometry(0.195, 0.265, 0.50, 22), suit, 0, -0.43, 0)
      // Shirt front panel
      mk(new THREE.PlaneGeometry(0.12, 0.30), shirt, 0, -0.33, 0.222)
      // Tie
      mk(new THREE.BoxGeometry(0.048, 0.24, 0.018), tie, 0, -0.34, 0.230)
      // Jacket lapels
      mk(new THREE.BoxGeometry(0.095, 0.26, 0.038), suit, -0.058, -0.30, 0.208, 0, 0, 0.26)
      mk(new THREE.BoxGeometry(0.095, 0.26, 0.038), suit, 0.058, -0.30, 0.208, 0, 0, -0.26)
      // Shoulders
      mk(new THREE.SphereGeometry(0.120, 16, 12), suit, -0.295, -0.215, 0)
      mk(new THREE.SphereGeometry(0.120, 16, 12), suit, 0.295, -0.215, 0)
      // Upper arms
      mk(new THREE.CylinderGeometry(0.065, 0.065, 0.24, 14), suit, -0.298, -0.370, 0, 0, 0, 0.17)
      mk(new THREE.CylinderGeometry(0.065, 0.065, 0.24, 14), suit, 0.298, -0.370, 0, 0, 0, -0.17)

      // ── Neck ────────────────────────────────────────────────────────────
      mk(new THREE.CylinderGeometry(0.054, 0.065, 0.125, 16), skin, 0, -0.048, 0)

      // ── Head ────────────────────────────────────────────────────────────
      const head = mk(new THREE.SphereGeometry(0.210, 28, 22), skin, 0, 0.238, 0)
      head.scale.set(1.0, 1.10, 0.91)

      // ── Hair ────────────────────────────────────────────────────────────
      mk(new THREE.SphereGeometry(0.216, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.43), hair, 0, 0.288, -0.016)
      mk(new THREE.SphereGeometry(0.098, 12, 9), hair, -0.172, 0.260, -0.058)
      mk(new THREE.SphereGeometry(0.098, 12, 9), hair, 0.172, 0.260, -0.058)
      // Front hairline
      mk(new THREE.SphereGeometry(0.06, 10, 8), hair, -0.10, 0.335, 0.10)
      mk(new THREE.SphereGeometry(0.06, 10, 8), hair, 0.10, 0.335, 0.10)

      // ── Ears ────────────────────────────────────────────────────────────
      mk(new THREE.SphereGeometry(0.036, 10, 8), skin, -0.210, 0.230, 0, 0, 0, 0, 1, 1.25, 0.52)
      mk(new THREE.SphereGeometry(0.036, 10, 8), skin, 0.210, 0.230, 0, 0, 0, 0, 1, 1.25, 0.52)

      // ── Eyes ────────────────────────────────────────────────────────────
      // Whites
      mk(new THREE.SphereGeometry(0.038, 14, 12), white, -0.080, 0.265, 0.184)
      mk(new THREE.SphereGeometry(0.038, 14, 12), white, 0.080, 0.265, 0.184)
      // Irises
      mk(new THREE.SphereGeometry(0.026, 12, 10), iris, -0.080, 0.265, 0.194)
      mk(new THREE.SphereGeometry(0.026, 12, 10), iris, 0.080, 0.265, 0.194)
      // Pupils
      mk(new THREE.SphereGeometry(0.014, 10, 8), pupil, -0.080, 0.265, 0.200)
      mk(new THREE.SphereGeometry(0.014, 10, 8), pupil, 0.080, 0.265, 0.200)
      // Eye shine
      const shine = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0, metalness: 1 })
      mk(new THREE.SphereGeometry(0.006, 6, 6), shine, -0.073, 0.272, 0.204)
      mk(new THREE.SphereGeometry(0.006, 6, 6), shine, 0.087, 0.272, 0.204)

      // ── Eyebrows ─────────────────────────────────────────────────────────
      mk(new THREE.BoxGeometry(0.068, 0.013, 0.011), brow, -0.080, 0.316, 0.194, 0, 0, -0.10)
      mk(new THREE.BoxGeometry(0.068, 0.013, 0.011), brow, 0.080, 0.316, 0.194, 0, 0, 0.10)

      // ── Nose ─────────────────────────────────────────────────────────────
      mk(new THREE.SphereGeometry(0.022, 10, 8), skin, 0, 0.215, 0.208)
      mk(new THREE.SphereGeometry(0.010, 8, 6), skin, -0.019, 0.202, 0.204)
      mk(new THREE.SphereGeometry(0.010, 8, 6), skin, 0.019, 0.202, 0.204)

      // ── Mouth ──────────────────────────────────────────────────────────
      // Upper lip
      mk(new THREE.BoxGeometry(0.084, 0.014, 0.010), lip, 0, 0.178, 0.204)
      // Lower lip (this one animates)
      const mouth = mk(new THREE.BoxGeometry(0.082, 0.016, 0.012), lip, 0, 0.163, 0.204)
      mouthRef.current = mouth
      // Mouth corners
      mk(new THREE.SphereGeometry(0.009, 6, 6), lip, -0.042, 0.170, 0.203)
      mk(new THREE.SphereGeometry(0.009, 6, 6), lip, 0.042, 0.170, 0.203)

      // ── Chin ─────────────────────────────────────────────────────────────
      mk(new THREE.SphereGeometry(0.058, 10, 8), skin, 0, 0.095, 0.138, 0, 0, 0, 1, 0.68, 0.78)

      // ── Subtle desk plane ────────────────────────────────────────────────
      const deskMat = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.7 })
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.025, 0.8), deskMat)
      desk.position.set(0, -0.78, 0.2)
      desk.receiveShadow = true
      scene.add(desk)

      // Background glow plane
      const glowGeo = new THREE.PlaneGeometry(3, 3)
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x060612, transparent: true, opacity: 0.95 })
      const glow = new THREE.Mesh(glowGeo, glowMat)
      glow.position.z = -1.5
      scene.add(glow)

      // Particles
      const pc = 60
      const pp = new Float32Array(pc * 3)
      for (let i = 0; i < pc; i++) {
        pp[i * 3] = (Math.random() - 0.5) * 5
        pp[i * 3 + 1] = (Math.random() - 0.5) * 4
        pp[i * 3 + 2] = (Math.random() - 0.5) * 2 - 1.5
      }
      const pGeo = new THREE.BufferGeometry()
      pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3))
      scene.add(new THREE.Points(pGeo,
        new THREE.PointsMaterial({ color: 0x7c3aed, size: 0.011, transparent: true, opacity: 0.30 })
      ))

      // ── Animation loop ────────────────────────────────────────────────────
      let t = 0
      const loop = () => {
        animFrameRef.current = requestAnimationFrame(loop)
        t += 0.016

        // Idle breathe + slight head movement
        g.position.y = Math.sin(t * 0.70) * 0.006
        g.rotation.y = Math.sin(t * 0.25) * 0.038
        g.rotation.z = Math.sin(t * 0.40) * 0.009

        // Mouth — opens wide when speaking, closes when not
        if (mouthRef.current) {
          const talking = isSpeakingRef.current
          const wantY = talking
            ? 0.012 + Math.abs(Math.sin(t * 10)) * 0.032  // animated open
            : 0.016                                          // closed
          const wantZ = talking ? 0.020 : 0.012
          mouthRef.current.scale.y += (wantY / 0.016 - mouthRef.current.scale.y) * 0.20
          mouthRef.current.scale.z += (wantZ / 0.012 - mouthRef.current.scale.z) * 0.20
          mouthRef.current.position.y = 0.163 - (mouthRef.current.scale.y - 1) * 0.008
        }

        renderer.render(scene, camera)
      }
      loop()

      return () => {
        cancelAnimationFrame(animFrameRef.current)
        renderer.dispose()
        window.speechSynthesis?.cancel()
      }
    }, [])

    // ── TTS speak ─────────────────────────────────────────────────────────────
    const speak = useCallback((text: string, onEnd?: () => void) => {
      if (!window.speechSynthesis) { onEnd?.(); return }
      window.speechSynthesis.cancel()

      // Small intro pause so avatar visually "takes a breath"
      setTimeout(() => {
        const utt = new SpeechSynthesisUtterance(text)
        utt.rate = 0.88
        utt.pitch = 0.95
        utt.volume = 1.0

        // Voice selection — prefer deep male voice for interviewer feel
        const voices = window.speechSynthesis.getVoices()
        const pick = voices.find(v =>
          v.lang.startsWith('en') && (
            v.name.includes('Daniel') || v.name.includes('Google UK English Male') ||
            v.name.includes('Alex') || v.name.includes('Fred') ||
            v.name.includes('Arthur')
          )
        ) || voices.find(v => v.lang === 'en-GB')
          || voices.find(v => v.lang === 'en-US')
          || voices[0]

        if (pick) utt.voice = pick

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

    // Expose methods to parent via ref
    useImperativeHandle(ref, () => ({ speak, stopSpeaking }), [speak, stopSpeaking])

    // Reset when question changes
    useEffect(() => {
      setHasSpoken(false)
      setStatusText('Click to hear question')
    }, [questionText])

    // Status based on phase
    useEffect(() => {
      if (phase === 'recording') setStatusText('Listening to your answer...')
      if (phase === 'analyzing') setStatusText('Analyzing your response...')
      if (phase === 'reviewed') setStatusText('Review feedback, then continue')
      if (phase === 'ready' && hasSpoken) setStatusText('Your turn — press Start Recording')
    }, [phase, hasSpoken])

    const isWaiting = phase === 'ready' && !isSpeaking
    const isListening = phase === 'recording'

    return (
      <div className="flex flex-col items-center">

        {/* Avatar container */}
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
                    style={{ border: '1px solid rgba(124,58,237,0.35)', width: `${40 + i * 22}%`, height: `${40 + i * 22}%` }}
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
              style={{ background: 'rgba(6,6,15,0.80)', backdropFilter: 'blur(10px)', border: '1px solid rgba(124,58,237,0.3)' }}>
              {isSpeaking && (
                <div className="flex gap-0.5 items-end h-3">
                  {[0, 1, 2, 1, 0].map((h, i) => (
                    <motion.div key={i} className="w-0.5 rounded-full"
                      style={{ background: '#7c3aed' }}
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
              style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}>
              Q{questionNumber}/{totalQuestions}
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