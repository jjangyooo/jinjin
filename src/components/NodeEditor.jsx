import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
//  DIRECTIONAL COLLAPSE
//
//  On Earth, a cube is a perfect orientation system:
//  its 6 faces point North, South, East, West, Up, Down.
//
//  This structure IS that system. The cube core = the reference frame.
//  Each of its 6 faces has a square-tube arm extending outward along its axis.
//  Those arms ARE the 6 cardinal directions — they are the geometry.
//
//  When nodes are dragged, the arms drift, fold, and twist.
//  "Up" tilts sideways. "North" bends toward the ground.
//  The cube still holds — connectivity never breaks —
//  but directional certainty collapses.
// ─────────────────────────────────────────────────────────────────────────────

const K = 1.0   // cube half-width
const R = 2.6   // arm reach — how far each directional arm extends

// ─────────────────────────────────────────────────────────────────────────────
//  32 NODE POSITIONS
//
//   0–7   cube core corners
//   8–11  UP   arm cap  (+Y)
//  12–15  DOWN arm cap  (−Y)
//  16–19  FWRD arm cap  (+Z)
//  20–23  BACK arm cap  (−Z)
//  24–27  RGHT arm cap  (+X)
//  28–31  LEFT arm cap  (−X)
// ─────────────────────────────────────────────────────────────────────────────

const INIT = [
  // Cube core
  [-K, -K, -K],  // 0
  [ K, -K, -K],  // 1
  [ K,  K, -K],  // 2
  [-K,  K, -K],  // 3
  [-K, -K,  K],  // 4
  [ K, -K,  K],  // 5
  [ K,  K,  K],  // 6
  [-K,  K,  K],  // 7

  // Up arm cap — above top face (nodes 3,2,6,7)
  [-K,  R, -K],  //  8  ← above 3
  [ K,  R, -K],  //  9  ← above 2
  [ K,  R,  K],  // 10  ← above 6
  [-K,  R,  K],  // 11  ← above 7

  // Down arm cap — below bottom face (nodes 0,1,5,4)
  [-K, -R, -K],  // 12  ← below 0
  [ K, -R, -K],  // 13  ← below 1
  [ K, -R,  K],  // 14  ← below 5
  [-K, -R,  K],  // 15  ← below 4

  // Forward arm cap — in front of front face (nodes 4,5,6,7)
  [-K, -K,  R],  // 16  ← front of 4
  [ K, -K,  R],  // 17  ← front of 5
  [ K,  K,  R],  // 18  ← front of 6
  [-K,  K,  R],  // 19  ← front of 7

  // Back arm cap — behind back face (nodes 0,1,2,3)
  [-K, -K, -R],  // 20  ← behind 0
  [ K, -K, -R],  // 21  ← behind 1
  [ K,  K, -R],  // 22  ← behind 2
  [-K,  K, -R],  // 23  ← behind 3

  // Right arm cap — right of right face (nodes 1,2,6,5)
  [ R, -K, -K],  // 24  ← right of 1
  [ R,  K, -K],  // 25  ← right of 2
  [ R,  K,  K],  // 26  ← right of 6
  [ R, -K,  K],  // 27  ← right of 5

  // Left arm cap — left of left face (nodes 0,3,7,4)
  [-R, -K, -K],  // 28  ← left of 0
  [-R,  K, -K],  // 29  ← left of 3
  [-R,  K,  K],  // 30  ← left of 7
  [-R, -K,  K],  // 31  ← left of 4
]

// ─────────────────────────────────────────────────────────────────────────────
//  60 EDGES — each rendered as a camera-facing plane strip
//  From straight-on: looks like a line.
//  From rotated angle: reveals surface area.
// ─────────────────────────────────────────────────────────────────────────────
const EDGES = [
  // Cube core — 12 edges
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7],

  // Up arm — 4 connectors + 4 cap ring
  [3,8],[2,9],[6,10],[7,11],
  [8,9],[9,10],[10,11],[11,8],

  // Down arm
  [0,12],[1,13],[5,14],[4,15],
  [12,13],[13,14],[14,15],[15,12],

  // Forward arm
  [4,16],[5,17],[6,18],[7,19],
  [16,17],[17,18],[18,19],[19,16],

  // Back arm
  [0,20],[1,21],[2,22],[3,23],
  [20,21],[21,22],[22,23],[23,20],

  // Right arm
  [1,24],[2,25],[6,26],[5,27],
  [24,25],[25,26],[26,27],[27,24],

  // Left arm
  [0,28],[3,29],[7,30],[4,31],
  [28,29],[29,30],[30,31],[31,28],
]

// ─────────────────────────────────────────────────────────────────────────────
//  36 FACES — thin translucent planar surfaces
// ─────────────────────────────────────────────────────────────────────────────
const FACES = [
  // Cube core — 6 faces (the orientation reference)
  [4,5,6,7],   // +Z face (forward)
  [1,0,3,2],   // −Z face (back)
  [0,4,7,3],   // −X face (left)
  [5,1,2,6],   // +X face (right)
  [0,1,5,4],   // −Y face (down)
  [3,7,6,2],   // +Y face (up)

  // Up arm — 4 side walls + 1 cap
  [3,2, 9, 8],
  [2,6,10, 9],
  [6,7,11,10],
  [7,3, 8,11],
  [8,9,10,11],   // cap

  // Down arm — 4 side walls + 1 cap
  [1,0,12,13],
  [5,1,13,14],
  [4,5,14,15],
  [0,4,15,12],
  [12,13,14,15], // cap

  // Forward arm — 4 side walls + 1 cap
  [4,5,17,16],
  [5,6,18,17],
  [6,7,19,18],
  [7,4,16,19],
  [16,17,18,19], // cap

  // Back arm — 4 side walls + 1 cap
  [0,1,21,20],
  [2,1,21,22],
  [3,2,22,23],
  [0,3,23,20],
  [20,21,22,23], // cap

  // Right arm — 4 side walls + 1 cap
  [1,5,27,24],
  [5,6,26,27],
  [6,2,25,26],
  [2,1,24,25],
  [24,25,26,27], // cap

  // Left arm — 4 side walls + 1 cap
  [0,4,31,28],
  [7,4,31,30],
  [3,7,30,29],
  [0,3,29,28],
  [28,29,30,31], // cap
]

// Opacity by face zone
function faceAlpha(i) {
  if (i < 6) return 0.055           // cube core — ghostly reference
  const local = (i - 6) % 5
  return local === 4 ? 0.092 : 0.068  // cap : side wall
}

// Opacity by edge zone
function edgeAlpha(i) {
  if (i < 12) return 0.68                         // cube core
  const local = (i - 12) % 8
  return local < 4 ? 0.80 : 0.92                 // connector : cap ring
}

const EDGE_HALF_W = 0.026

// ─────────────────────────────────────────────────────────────────────────────
//  FACE PLANE — thin translucent quad surface
// ─────────────────────────────────────────────────────────────────────────────
function FacePlane({ ids, getPos, alpha }) {
  const gRef = useRef()

  useFrame(() => {
    if (!gRef.current) return
    const attr = gRef.current.attributes.position
    for (let i = 0; i < 4; i++) {
      const p = getPos(ids[i])
      attr.setXYZ(i, p[0], p[1], p[2])
    }
    attr.needsUpdate = true
  })

  return (
    <mesh renderOrder={0}>
      <bufferGeometry ref={gRef}>
        <bufferAttribute
          attach="attributes-position"
          count={4}
          array={new Float32Array(12)}
          itemSize={3}
        />
        <bufferAttribute
          attach="index"
          array={new Uint16Array([0,1,2, 0,2,3])}
          itemSize={1}
        />
      </bufferGeometry>
      <meshBasicMaterial
        color="#ffffff"
        side={THREE.DoubleSide}
        transparent
        opacity={alpha}
        depthWrite={false}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  EDGE STRIP — camera-facing thin plane between two nodes
// ─────────────────────────────────────────────────────────────────────────────
function EdgeStrip({ a, b, getPos, alpha }) {
  const gRef   = useRef()
  const { camera } = useThree()

  const va  = useRef(new THREE.Vector3())
  const vb  = useRef(new THREE.Vector3())
  const dir = useRef(new THREE.Vector3())
  const mid = useRef(new THREE.Vector3())
  const toc = useRef(new THREE.Vector3())
  const nor = useRef(new THREE.Vector3())
  const up  = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!gRef.current) return
    const pa = getPos(a), pb = getPos(b)
    va.current.set(pa[0], pa[1], pa[2])
    vb.current.set(pb[0], pb[1], pb[2])
    dir.current.subVectors(vb.current, va.current)
    if (dir.current.length() < 0.001) return
    dir.current.normalize()
    mid.current.addVectors(va.current, vb.current).multiplyScalar(0.5)
    toc.current.subVectors(camera.position, mid.current).normalize()
    nor.current.crossVectors(dir.current, toc.current)
    if (nor.current.length() < 0.001) nor.current.set(0, 1, 0)
    nor.current.normalize()
    up.current.crossVectors(nor.current, dir.current).normalize()

    const W  = EDGE_HALF_W
    const ux = up.current.x * W, uy = up.current.y * W, uz = up.current.z * W
    const pos = gRef.current.attributes.position
    pos.setXYZ(0, pa[0]+ux, pa[1]+uy, pa[2]+uz)
    pos.setXYZ(1, pa[0]-ux, pa[1]-uy, pa[2]-uz)
    pos.setXYZ(2, pb[0]+ux, pb[1]+uy, pb[2]+uz)
    pos.setXYZ(3, pb[0]-ux, pb[1]-uy, pb[2]-uz)
    pos.needsUpdate = true
  })

  return (
    <mesh renderOrder={1}>
      <bufferGeometry ref={gRef}>
        <bufferAttribute
          attach="attributes-position"
          count={4}
          array={new Float32Array(12)}
          itemSize={3}
        />
        <bufferAttribute
          attach="index"
          array={new Uint16Array([0,1,2, 1,3,2])}
          itemSize={1}
        />
      </bufferGeometry>
      <meshBasicMaterial
        color="#ffffff"
        side={THREE.DoubleSide}
        transparent
        opacity={alpha}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  NODE HANDLE — minimal draggable control point
//  Structurally invisible. Only becomes visible on hover/select.
// ─────────────────────────────────────────────────────────────────────────────
function NodeHandle({ id, getPos, onDrag, onSelect, selected }) {
  const { camera, gl, raycaster } = useThree()
  const mRef    = useRef()
  const active  = useRef(false)
  const plane   = useRef(new THREE.Plane())
  const offset  = useRef(new THREE.Vector3())
  const hit     = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!mRef.current) return
    const p = getPos(id)
    mRef.current.position.set(p[0], p[1], p[2])
  })

  const onDown = useCallback(e => {
    e.stopPropagation()
    active.current = true
    onSelect(id)
    const p = getPos(id)
    const v = new THREE.Vector3(p[0], p[1], p[2])
    const d = new THREE.Vector3()
    camera.getWorldDirection(d)
    plane.current.setFromNormalAndCoplanarPoint(d, v)
    raycaster.ray.intersectPlane(plane.current, hit.current)
    offset.current.subVectors(v, hit.current)
    gl.domElement.style.cursor = 'grabbing'
  }, [id, camera, gl, getPos, onSelect, raycaster])

  const onMove = useCallback(e => {
    if (!active.current) return
    e.stopPropagation()
    if (raycaster.ray.intersectPlane(plane.current, hit.current)) {
      const n = hit.current.clone().add(offset.current)
      onDrag(id, [n.x, n.y, n.z])
    }
  }, [id, onDrag, raycaster])

  const onUp = useCallback(e => {
    e.stopPropagation()
    active.current = false
    gl.domElement.style.cursor = 'grab'
  }, [gl])

  return (
    <mesh
      ref={mRef}
      position={getPos(id)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerEnter={() => { if (!active.current) gl.domElement.style.cursor = 'grab' }}
      onPointerLeave={() => { if (!active.current) gl.domElement.style.cursor = 'default' }}
    >
      <sphereGeometry args={[selected ? 0.10 : 0.048, 12, 12]} />
      <meshBasicMaterial
        color={selected ? '#ffffff' : '#222222'}
        transparent
        opacity={selected ? 1.0 : 0.55}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCENE
// ─────────────────────────────────────────────────────────────────────────────
function Scene({ posRef, onDrag }) {
  const ctrlRef = useRef()
  const [sel, setSel] = useState(-1)
  const getPos = useCallback(id => posRef.current[id], [posRef])

  const handleSelect = useCallback(id => {
    setSel(id)
    if (ctrlRef.current) ctrlRef.current.enabled = false
  }, [])

  useEffect(() => {
    const up = () => {
      setSel(-1)
      if (ctrlRef.current) ctrlRef.current.enabled = true
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  return (
    <>
      <OrbitControls
        ref={ctrlRef}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.48}
        zoomSpeed={0.75}
      />

      {FACES.map((ids, i) => (
        <FacePlane key={`f${i}`} ids={ids} getPos={getPos} alpha={faceAlpha(i)} />
      ))}

      {EDGES.map(([a, b], i) => (
        <EdgeStrip key={`e${i}`} a={a} b={b} getPos={getPos} alpha={edgeAlpha(i)} />
      ))}

      {INIT.map((_, id) => (
        <NodeHandle
          key={`n${id}`}
          id={id}
          getPos={getPos}
          onDrag={onDrag}
          onSelect={handleSelect}
          selected={sel === id}
        />
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function NodeEditor() {
  // Ref-based positions: drag never triggers React re-renders.
  // All geometry updates happen in useFrame at native 60fps.
  const posRef = useRef(INIT.map(p => [...p]))

  const handleDrag = useCallback((id, pos) => {
    posRef.current = posRef.current.map((p, i) => i === id ? pos : p)
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Canvas
        camera={{ position: [6.5, 5.5, 8.5], fov: 44 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#000000']} />
        <Scene posRef={posRef} onDrag={handleDrag} />
      </Canvas>

      <div style={{
        position:      'fixed',
        bottom:        22,
        left:          22,
        color:         'rgba(255,255,255,0.10)',
        fontFamily:    'monospace',
        fontSize:       9.5,
        letterSpacing: '0.20em',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        lineHeight:     2.2,
        userSelect:    'none',
      }}>
        <div>Drag · Orbit · Scroll</div>
        <div style={{ opacity: 0.35 }}>Directional Collapse</div>
      </div>
    </div>
  )
}
