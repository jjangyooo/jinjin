import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
//  DIRECTIONAL COLLAPSE
//
//  A spatial orientation system (think: compass cube, navigation frame)
//  that is losing its directional certainty.
//
//  Structure: two concentric cubes.
//    Outer cube  (nodes 0–7):  the stable reference frame.
//                               Its 6 faces = the 6 cardinal directions.
//    Inner cube  (nodes 8–15): the same frame, but twisted 22° around Y.
//                               Represents actual orientation that has drifted.
//    Connectors  (16 edges):   the visible relationship between reference
//                               and reality — twisted diagonal struts.
//
//  When nodes are dragged, the orientation framework itself deforms.
//  "North" can become diagonal. "Up" can fold inward.
//  Structural connectivity is always preserved; directional logic is not.
// ─────────────────────────────────────────────────────────────────────────────

const TWIST_DEG = 22
const TWIST     = TWIST_DEG * Math.PI / 180
const COS       = Math.cos(TWIST)
const SIN       = Math.sin(TWIST)

function rotY(x, y, z) {
  return [x * COS - z * SIN, y, x * SIN + z * COS]
}

const OW = 2.0   // outer cube half-width
const IW = 1.1   // inner cube half-width (before rotation)

// Pre-compute initial node positions at module load
const INIT = [
  // ── Outer cube (nodes 0–7) ── stable reference frame
  [-OW, -OW, -OW],  // 0  back  bottom  left
  [ OW, -OW, -OW],  // 1  back  bottom  right
  [ OW,  OW, -OW],  // 2  back  top     right
  [-OW,  OW, -OW],  // 3  back  top     left
  [-OW, -OW,  OW],  // 4  front bottom  left
  [ OW, -OW,  OW],  // 5  front bottom  right
  [ OW,  OW,  OW],  // 6  front top     right
  [-OW,  OW,  OW],  // 7  front top     left

  // ── Inner cube (nodes 8–15) ── twisted 22° around Y, directional drift
  ...([
    [-IW, -IW, -IW],  // → 8
    [ IW, -IW, -IW],  // → 9
    [ IW,  IW, -IW],  // → 10
    [-IW,  IW, -IW],  // → 11
    [-IW, -IW,  IW],  // → 12
    [ IW, -IW,  IW],  // → 13
    [ IW,  IW,  IW],  // → 14
    [-IW,  IW,  IW],  // → 15
  ].map(([x, y, z]) => rotY(x, y, z))),
]

// ─── Faces (quads, 4 node IDs each) ─────────────────────────────────────────
// Rendered as ghostly translucent planes — the spatial surfaces.
const FACES = [
  // Outer cube — all 6 faces (very subtle, the reference frame)
  [4, 5, 6, 7],    // outer front
  [1, 0, 3, 2],    // outer back
  [0, 4, 7, 3],    // outer left
  [5, 1, 2, 6],    // outer right
  [0, 1, 5, 4],    // outer bottom
  [3, 7, 6, 2],    // outer top

  // Inner cube — all 6 faces (slightly brighter — the "real" frame)
  [12, 13, 14, 15], // inner front
  [ 9,  8, 11, 10], // inner back
  [ 8, 12, 15, 11], // inner left
  [13,  9, 10, 14], // inner right
  [ 8,  9, 13, 12], // inner bottom
  [11, 15, 14, 10], // inner top

  // Connecting trapezoids — the zone where reference meets drift
  // These are non-planar quads: they fold because inner is rotated.
  // This fold IS the impossibility.
  [0, 1,  9,  8],  // back  bottom  connector
  [4, 5, 13, 12],  // front bottom  connector
  [0, 4, 12,  8],  // left  bottom  connector
  [1, 5, 13,  9],  // right bottom  connector
  [3, 2, 10, 11],  // back  top     connector
  [7, 6, 14, 15],  // front top     connector
  [3, 7, 15, 11],  // left  top     connector
  [2, 6, 14, 10],  // right top     connector
]

// Face opacity by zone (inner, outer, connecting get slightly different treatment)
const FACE_ALPHA = (i) => {
  if (i < 6)  return 0.055  // outer — barely there, stable reference
  if (i < 12) return 0.090  // inner — slightly more visible, drifted frame
  return 0.110               // connectors — the tension zone
}

// ─── Edges (pairs of node IDs) ───────────────────────────────────────────────
// Each edge renders as a camera-facing plane strip (not a line).
const EDGES = [
  // Outer cube — 12 edges
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7],

  // Inner cube — 12 edges
  [8,9],[9,10],[10,11],[11,8],
  [12,13],[13,14],[14,15],[15,12],
  [8,12],[9,13],[10,14],[11,15],

  // Connectors — 8 twisted diagonal struts.
  // These are not orthogonal because inner cube is rotated.
  // They are the visible proof of directional collapse.
  [0,8],[1,9],[2,10],[3,11],
  [4,12],[5,13],[6,14],[7,15],
]

const EDGE_HW = 0.026  // edge strip half-width
const EDGE_ALPHA = (i) => {
  if (i < 12) return 0.70   // outer cube edges — slightly dimmer
  if (i < 24) return 0.85   // inner cube edges — the shifted frame
  return 0.95                // connecting diagonal struts — most visible
}

// ─────────────────────────────────────────────────────────────────────────────
//  FACE PLANE
//  A thin quad surface defined by 4 nodes. Updates every frame.
// ─────────────────────────────────────────────────────────────────────────────
function FacePlane({ nodeIds, getPos, opacity }) {
  const gRef = useRef()

  useFrame(() => {
    if (!gRef.current) return
    const attr = gRef.current.attributes.position
    for (let i = 0; i < 4; i++) {
      const p = getPos(nodeIds[i])
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
          array={new Uint16Array([0, 1, 2,  0, 2, 3])}
          itemSize={1}
        />
      </bufferGeometry>
      <meshBasicMaterial
        color="#ffffff"
        side={THREE.DoubleSide}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  EDGE STRIP
//  Camera-facing plane strip between two nodes.
//  Straight-on: looks like a line.
//  Rotated: reveals surface area — the "planar ribbon" effect.
// ─────────────────────────────────────────────────────────────────────────────
function EdgeStrip({ nA, nB, getPos, opacity }) {
  const gRef = useRef()
  const { camera } = useThree()

  // Reuse Vector3 instances to avoid GC pressure at 60fps
  const va  = useRef(new THREE.Vector3())
  const vb  = useRef(new THREE.Vector3())
  const dir = useRef(new THREE.Vector3())
  const mid = useRef(new THREE.Vector3())
  const cam = useRef(new THREE.Vector3())
  const nor = useRef(new THREE.Vector3())
  const up  = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!gRef.current) return

    const pa = getPos(nA)
    const pb = getPos(nB)
    va.current.set(pa[0], pa[1], pa[2])
    vb.current.set(pb[0], pb[1], pb[2])

    dir.current.subVectors(vb.current, va.current)
    if (dir.current.length() < 0.001) return
    dir.current.normalize()

    mid.current.addVectors(va.current, vb.current).multiplyScalar(0.5)
    cam.current.subVectors(camera.position, mid.current).normalize()

    // plane normal = cross(edgeDir, toCam)
    nor.current.crossVectors(dir.current, cam.current)
    if (nor.current.length() < 0.001) nor.current.set(0, 1, 0)
    nor.current.normalize()

    // plane "up" = cross(normal, edgeDir) — this is the strip width direction
    up.current.crossVectors(nor.current, dir.current).normalize()

    const W  = EDGE_HW
    const ux = up.current.x * W
    const uy = up.current.y * W
    const uz = up.current.z * W

    const pos = gRef.current.attributes.position
    pos.setXYZ(0, pa[0] + ux, pa[1] + uy, pa[2] + uz)
    pos.setXYZ(1, pa[0] - ux, pa[1] - uy, pa[2] - uz)
    pos.setXYZ(2, pb[0] + ux, pb[1] + uy, pb[2] + uz)
    pos.setXYZ(3, pb[0] - ux, pb[1] - uy, pb[2] - uz)
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
          array={new Uint16Array([0, 1, 2,  1, 3, 2])}
          itemSize={1}
        />
      </bufferGeometry>
      <meshBasicMaterial
        color="#ffffff"
        side={THREE.DoubleSide}
        transparent
        opacity={opacity}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  NODE HANDLE
//  Minimal draggable control point. The structure is the visual, not the node.
// ─────────────────────────────────────────────────────────────────────────────
function NodeHandle({ id, getPos, onDrag, onSelect, isSelected }) {
  const { camera, gl, raycaster } = useThree()
  const meshRef  = useRef()
  const dragging = useRef(false)
  const plane    = useRef(new THREE.Plane())
  const offset   = useRef(new THREE.Vector3())
  const hitPt    = useRef(new THREE.Vector3())

  // Keep mesh position synced to node position every frame
  useFrame(() => {
    if (!meshRef.current) return
    const p = getPos(id)
    meshRef.current.position.set(p[0], p[1], p[2])
  })

  const onDown = useCallback(e => {
    e.stopPropagation()
    dragging.current = true
    onSelect(id)
    const p = getPos(id)
    const nodeVec = new THREE.Vector3(p[0], p[1], p[2])
    const camDir  = new THREE.Vector3()
    camera.getWorldDirection(camDir)
    plane.current.setFromNormalAndCoplanarPoint(camDir, nodeVec)
    raycaster.ray.intersectPlane(plane.current, hitPt.current)
    offset.current.subVectors(nodeVec, hitPt.current)
    gl.domElement.style.cursor = 'grabbing'
  }, [id, camera, gl, getPos, onSelect, raycaster])

  const onMove = useCallback(e => {
    if (!dragging.current) return
    e.stopPropagation()
    if (raycaster.ray.intersectPlane(plane.current, hitPt.current)) {
      const np = hitPt.current.clone().add(offset.current)
      onDrag(id, [np.x, np.y, np.z])
    }
  }, [id, onDrag, raycaster])

  const onUp = useCallback(e => {
    e.stopPropagation()
    dragging.current = false
    gl.domElement.style.cursor = 'grab'
  }, [gl])

  const initPos = getPos(id)

  return (
    <mesh
      ref={meshRef}
      position={initPos}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerEnter={() => { if (!dragging.current) gl.domElement.style.cursor = 'grab' }}
      onPointerLeave={() => { if (!dragging.current) gl.domElement.style.cursor = 'default' }}
    >
      <sphereGeometry args={[isSelected ? 0.10 : 0.052, 14, 14]} />
      <meshBasicMaterial
        color={isSelected ? '#ffffff' : '#2e2e2e'}
        transparent
        opacity={isSelected ? 1.0 : 0.60}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCENE
// ─────────────────────────────────────────────────────────────────────────────
function Scene({ posRef, onDrag }) {
  const controlsRef = useRef()
  const [selected, setSelected] = useState(-1)

  // getPos reads from the ref — always current, zero re-renders
  const getPos = useCallback(id => posRef.current[id], [posRef])

  const handleSelect = useCallback(id => {
    setSelected(id)
    if (controlsRef.current) controlsRef.current.enabled = false
  }, [])

  // Re-enable orbit controls on pointer up (anywhere on page)
  useEffect(() => {
    const release = () => {
      setSelected(-1)
      if (controlsRef.current) controlsRef.current.enabled = true
    }
    window.addEventListener('pointerup', release)
    return () => window.removeEventListener('pointerup', release)
  }, [])

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.50}
        zoomSpeed={0.75}
        target={[0, 0, 0]}
      />

      {/* Ghost face planes — spatial surfaces */}
      {FACES.map((face, i) => (
        <FacePlane
          key={`f${i}`}
          nodeIds={face}
          getPos={getPos}
          opacity={FACE_ALPHA(i)}
        />
      ))}

      {/* Edge plane strips */}
      {EDGES.map(([a, b], i) => (
        <EdgeStrip
          key={`e${i}`}
          nA={a}
          nB={b}
          getPos={getPos}
          opacity={EDGE_ALPHA(i)}
        />
      ))}

      {/* Node handles — barely visible control points */}
      {INIT.map((_, id) => (
        <NodeHandle
          key={`n${id}`}
          id={id}
          getPos={getPos}
          onDrag={onDrag}
          onSelect={handleSelect}
          isSelected={selected === id}
        />
      ))}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function NodeEditor() {
  // Positions in a ref: drag updates bypass React reconciliation entirely.
  // All geometry updates happen inside useFrame at 60fps.
  const posRef = useRef(INIT.map(p => [...p]))

  const handleDrag = useCallback((id, newPos) => {
    posRef.current = posRef.current.map((p, i) => i === id ? newPos : p)
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Canvas
        camera={{ position: [5.8, 4.2, 7.4], fov: 44 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#000000']} />
        <Scene posRef={posRef} onDrag={handleDrag} />
      </Canvas>

      <div style={{
        position: 'fixed',
        bottom: 24,
        left: 24,
        color: 'rgba(255,255,255,0.11)',
        fontFamily: 'monospace',
        fontSize: 10,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        lineHeight: 2.1,
        userSelect: 'none',
      }}>
        <div>Drag nodes · Orbit · Scroll</div>
        <div style={{ opacity: 0.38 }}>Directional Collapse</div>
      </div>
    </div>
  )
}
