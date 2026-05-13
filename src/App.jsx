// ─────────────────────────────────────────────────────────────────────────────
// Compass Direction System — 2D → 2.5D Spatial Transformation
// npm install && npm run dev
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { useControls, folder } from 'leva'
import * as THREE from 'three'

// ─── Topology — fixed forever ─────────────────────────────────────────────────

const R = 2.2

const BASE = {
  N:  [ 0,         R,         0],
  E:  [ R,         0,         0],
  S:  [ 0,        -R,         0],
  W:  [-R,         0,         0],
  NE: [ R * 0.707, R * 0.707, 0],
  SE: [ R * 0.707,-R * 0.707, 0],
  SW: [-R * 0.707,-R * 0.707, 0],
  NW: [-R * 0.707, R * 0.707, 0],
  C:  [ 0,         0,         0],
}

// Edges are the invariant topology — only positions move
const EDGES = [
  ['N',  'S' ], ['E',  'W' ],
  ['N',  'E' ], ['E',  'S' ], ['S',  'W' ], ['W',  'N' ],
  ['NE', 'SW'], ['NW', 'SE'],
  ['N',  'NE'], ['NE', 'E' ], ['E',  'SE'], ['SE', 'S' ],
  ['S',  'SW'], ['SW', 'W' ], ['W',  'NW'], ['NW', 'N' ],
  ['C',  'N' ], ['C',  'E' ], ['C',  'S' ], ['C',  'W' ],
]

const KEYS = Object.keys(BASE)

// Per-key unique hash for independent phase offsets
const PH = Object.fromEntries(
  KEYS.map(k => [k, k.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 7), 0)])
)

// ─── Motion targets per mode ──────────────────────────────────────────────────

function computeTargets(mode, t, { strength, zDepth, rotSpeed, speed }) {
  const out = {}

  for (const key of KEYS) {
    const [bx, by] = BASE[key]
    const h = PH[key]
    let x = bx, y = by, z = 0

    switch (mode) {
      case 'FLAT':
        // Nearly 2D — breath-like micro-oscillation
        x += Math.sin(t * speed * 0.22 + h * 0.28) * 0.07 * strength
        y += Math.cos(t * speed * 0.27 + h * 0.35) * 0.07 * strength
        z  = Math.sin(t * speed * 0.32 + h * 0.55) * 0.09 * strength
        break

      case 'DEPTH':
        // Nodes float to independent z positions, shape stays readable
        x += Math.sin(t * speed * 0.18 + h * 0.30) * 0.22 * strength
        y += Math.cos(t * speed * 0.23 + h * 0.38) * 0.22 * strength
        z  = Math.sin(t * speed * 0.35 + h * 0.75) * zDepth * strength
        break

      case 'ORBIT': {
        // Each node orbits at its own radius, all at the same angular speed
        const r = Math.hypot(bx, by)
        const baseAng = Math.atan2(by, bx)
        const a = baseAng + t * speed * rotSpeed * 0.28
        x = r * Math.cos(a)
        y = r * Math.sin(a)
        z = Math.sin(t * speed * 0.45 + h * 0.50) * zDepth * 0.55 * strength
        break
      }

      case 'CONSTELLATION':
        // Slow star-map drift — nodes wander but stay gravitationally tethered
        x += Math.sin(t * speed * 0.09 + h * 1.18) * 0.95 * strength
        y += Math.cos(t * speed * 0.12 + h * 0.92) * 0.95 * strength
        z  = Math.sin(t * speed * 0.14 + h * 0.68) * zDepth * strength
        break

      case 'COLLAPSE': {
        // Breathes between order (expanded) and chaos (collapsed)
        const phase = Math.sin(t * speed * 0.18) * 0.5 + 0.5 // 0=chaos 1=order
        const cx = Math.sin(t * speed * 1.35 + h * 1.25) * 0.75
        const cy = Math.cos(t * speed * 1.15 + h * 1.10) * 0.75
        x = bx * phase + cx * (1 - phase) * strength
        y = by * phase + cy * (1 - phase) * strength
        z = Math.sin(t * speed * 0.42 + h) * zDepth * (1 - phase * 0.35) * strength
        break
      }
    }

    out[key] = [x, y, z]
  }

  return out
}

// ─── Edge — updates BufferAttribute directly each frame ───────────────────────

function Edge({ a, b, positions }) {
  const { obj, attr } = useMemo(() => {
    const arr  = new Float32Array(6)
    const attr = new THREE.BufferAttribute(arr, 3)
    const geo  = new THREE.BufferGeometry()
    geo.setAttribute('position', attr)
    const mat = new THREE.LineBasicMaterial({ color: 0x111111 })
    return { obj: new THREE.Line(geo, mat), attr }
  }, [])

  useFrame(() => {
    const pa = positions.current[a]
    const pb = positions.current[b]
    if (!pa || !pb) return
    const d = attr.array
    d[0] = pa[0]; d[1] = pa[1]; d[2] = pa[2]
    d[3] = pb[0]; d[4] = pb[1]; d[5] = pb[2]
    attr.needsUpdate = true
  })

  return <primitive object={obj} />
}

// ─── Node dot ─────────────────────────────────────────────────────────────────

function Node({ id, positions, size }) {
  const ref = useRef()

  useFrame(() => {
    const p = positions.current[id]
    if (ref.current && p) ref.current.position.set(p[0], p[1], p[2])
  })

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size, 12, 12]} />
      <meshBasicMaterial color="#111111" />
    </mesh>
  )
}

// ─── Direction label (floats just outside the node) ───────────────────────────

function Label({ id, positions, fontSize }) {
  const ref = useRef()

  useFrame(() => {
    if (!ref.current) return
    const p = positions.current[id]
    if (!p) return
    // Offset outward from center so labels don't sit on nodes
    const len = Math.max(Math.hypot(p[0], p[1]), 0.12)
    ref.current.position.set(
      p[0] + (p[0] / len) * 0.38,
      p[1] + (p[1] / len) * 0.38,
      p[2]
    )
  })

  return (
    <Text
      ref={ref}
      fontSize={fontSize}
      color="#111111"
      anchorX="center"
      anchorY="middle"
      letterSpacing={0.06}
    >
      {id}
    </Text>
  )
}

// ─── Scene — holds all mutable state, physics, controls ───────────────────────

function Scene() {
  const { camera } = useThree()

  // All mutable state lives in refs — updated imperatively each frame
  const mouse = useRef([0, 0])
  const pos   = useRef(Object.fromEntries(KEYS.map(k => [k, [...BASE[k]]])))
  const vel   = useRef(Object.fromEntries(KEYS.map(k => [k, [0, 0, 0]])))

  const {
    mode,
    strength, speed, zDepth, rotSpeed,
    spring, damping, mousePull,
    nodeSize, fontSize, showLabels,
  } = useControls({
    mode: {
      label: 'Mode',
      value: 'DEPTH',
      options: ['FLAT', 'DEPTH', 'ORBIT', 'CONSTELLATION', 'COLLAPSE'],
    },
    Motion: folder({
      strength:  { label: 'Strength',  value: 1.0,  min: 0,    max: 3,    step: 0.01 },
      speed:     { label: 'Speed',     value: 0.65, min: 0,    max: 4,    step: 0.01 },
      zDepth:    { label: 'Z Depth',   value: 1.6,  min: 0,    max: 5,    step: 0.01 },
      rotSpeed:  { label: 'Rotation',  value: 1.0,  min: 0,    max: 5,    step: 0.01 },
      spring:    { label: 'Spring',    value: 5.5,  min: 1,    max: 20,   step: 0.1  },
      damping:   { label: 'Damping',   value: 0.88, min: 0.50, max: 0.99, step: 0.01 },
      mousePull: { label: 'Mouse Pull',value: 1.2,  min: 0,    max: 5,    step: 0.01 },
    }),
    Visual: folder({
      nodeSize:   { label: 'Node Size',   value: 0.065, min: 0.01, max: 0.25, step: 0.001 },
      showLabels: { label: 'Labels',      value: true },
      fontSize:   { label: 'Label Size',  value: 0.20,  min: 0.05, max: 0.5,  step: 0.01  },
    }),
  })

  useEffect(() => {
    const onMove = e => {
      mouse.current = [
        (e.clientX / window.innerWidth)  * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      ]
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useFrame(({ clock }) => {
    const t  = clock.getElapsedTime()
    const tg = computeTargets(mode, t, { strength, zDepth, rotSpeed, speed })

    // Mouse world-space coordinates (approximate, z=0 plane)
    const [mx, my] = mouse.current
    const wx = mx * R * 1.15
    const wy = my * R * 1.15

    const kf = spring * 0.08

    for (const k of KEYS) {
      const p = pos.current[k]
      const v = vel.current[k]
      const g = tg[k]

      // Spring force toward target
      let fx = (g[0] - p[0]) * kf
      let fy = (g[1] - p[1]) * kf
      const fz = (g[2] - p[2]) * kf

      // Magnetic mouse pull — proximity-weighted
      if (mousePull > 0) {
        const dx = wx - p[0]
        const dy = wy - p[1]
        const d2 = dx * dx + dy * dy
        if (d2 < 7) {
          const f = (mousePull * 0.013) / (Math.sqrt(d2) + 0.45)
          fx += dx * f
          fy += dy * f
        }
      }

      v[0] = (v[0] + fx) * damping
      v[1] = (v[1] + fy) * damping
      v[2] = (v[2] + fz) * damping

      p[0] += v[0]
      p[1] += v[1]
      p[2] += v[2]
    }

    // Camera parallax — gentle drift toward mouse direction
    camera.position.x += (mx * 0.42 - camera.position.x) * 0.04
    camera.position.y += (my * 0.42 - camera.position.y) * 0.04
    camera.lookAt(0, 0, 0)
  })

  return (
    <>
      {EDGES.map(([a, b]) => (
        <Edge key={`${a}-${b}`} a={a} b={b} positions={pos} />
      ))}
      {KEYS.map(k => (
        <Node key={k} id={k} positions={pos} size={nodeSize} />
      ))}
      {showLabels && KEYS.filter(k => k !== 'C').map(k => (
        <Label key={`lbl-${k}`} id={k} positions={pos} fontSize={fontSize} />
      ))}
    </>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#ffffff' }}>
      {/*
        Narrow FOV (22°) gives a near-orthographic look while still letting
        z-depth read as genuine spatial recession — not a flat projection.
      */}
      <Canvas
        camera={{ fov: 22, position: [0, 0, 14], near: 0.01, far: 100 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#ffffff']} />
        <Scene />
      </Canvas>
    </div>
  )
}
