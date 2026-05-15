import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE DEFINITION
// Two cubes sharing an impossible junction — the overlapping zone creates
// spatial ambiguity. Camera angle determines which cube reads as "in front".
// ─────────────────────────────────────────────────────────────────────────────

const INIT = [
  // Cube A — anchored at origin
  [-1.6, -1.6, -1.6],  // 0  BBL
  [ 1.6, -1.6, -1.6],  // 1  BBR
  [ 1.6,  1.6, -1.6],  // 2  BTR
  [-1.6,  1.6, -1.6],  // 3  BTL
  [-1.6, -1.6,  1.6],  // 4  FBL
  [ 1.6, -1.6,  1.6],  // 5  FBR
  [ 1.6,  1.6,  1.6],  // 6  FTR
  [-1.6,  1.6,  1.6],  // 7  FTL

  // Cube B — offset diagonally, creates impossible junction with A
  [ 0.0, -1.6,  0.0],  // 8  BBL-B
  [ 3.2, -1.6,  0.0],  // 9  BBR-B
  [ 3.2,  1.6,  0.0],  // 10 BTR-B
  [ 0.0,  1.6,  0.0],  // 11 BTL-B
  [ 0.0, -1.6,  3.2],  // 12 FBL-B
  [ 3.2, -1.6,  3.2],  // 13 FBR-B
  [ 3.2,  1.6,  3.2],  // 14 FTR-B
  [ 0.0,  1.6,  3.2],  // 15 FTL-B

  // Vertical spire — extends up from the junction to add 4th axis
  [ 0.0,  4.0,  0.0],  // 16 apex-back
  [ 3.2,  4.0,  0.0],  // 17 apex-right-back
  [ 3.2,  4.0,  3.2],  // 18 apex-right-front
  [ 0.0,  4.0,  3.2],  // 19 apex-front
]

// Faces — each is an array of 4 node IDs forming a quad (CCW winding)
const FACES = [
  // Cube A — show 3 faces (isometric visible faces)
  [4, 5, 6, 7],    // A front
  [7, 6, 2, 3],    // A top
  [5, 1, 2, 6],    // A right

  // Cube B — show 3 corresponding faces
  [12, 13, 14, 15], // B front
  [15, 14, 10, 11], // B top
  [13,  9, 10, 14], // B right

  // Junction / bridge faces (the "impossible" zone)
  [5, 12, 15, 6],   // bridge front  — connects A.FBR→B.FBL and A.FTR→B.FTL
  [6, 15, 11, 2],   // bridge top    — connects A.FTR→B.FTL and A.BTR→B.BTL
  [5,  1, 9, 13],   // bridge bottom-right

  // Spire faces
  [11, 10, 17, 16], // spire back
  [10, 14, 18, 17], // spire right
  [14, 15, 19, 18], // spire front
  [15, 11, 16, 19], // spire left
]

// Edges — pairs of node IDs
const EDGES = [
  // Cube A — all 12 edges
  [0, 1], [1, 2], [2, 3], [3, 0],   // back face
  [4, 5], [5, 6], [6, 7], [7, 4],   // front face
  [0, 4], [1, 5], [2, 6], [3, 7],   // depth edges

  // Cube B — all 12 edges
  [8,  9], [9, 10], [10, 11], [11,  8],
  [12, 13], [13, 14], [14, 15], [15, 12],
  [8, 12], [9, 13], [10, 14], [11, 15],

  // Junction bridge edges
  [5, 12], [6, 15], [2, 11], [1, 9],

  // Spire edges
  [11, 16], [10, 17], [14, 18], [15, 19],
  [16, 17], [17, 18], [18, 19], [19, 16],
]

const EDGE_HW    = 0.030   // half-width of each edge strip
const FACE_ALPHA = 0.10    // face opacity — ghostly planes
const EDGE_ALPHA = 0.92    // edge opacity — solid-ish white

// ─────────────────────────────────────────────────────────────────────────────
// FACE PLANE — thin quad surface between 4 nodes
// ─────────────────────────────────────────────────────────────────────────────
function FacePlane({ nodeIds, getPos }) {
  const geoRef = useRef()

  useFrame(() => {
    if (!geoRef.current) return
    const attr = geoRef.current.attributes.position
    nodeIds.forEach((id, i) => {
      const p = getPos(id)
      attr.setXYZ(i, p[0], p[1], p[2])
    })
    attr.needsUpdate = true
  })

  return (
    <mesh renderOrder={0}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute
          attach="attributes-position"
          count={4}
          array={new Float32Array(12)}
          itemSize={3}
        />
        <bufferAttribute
          attach="index"
          array={new Uint16Array([0, 1, 2, 0, 2, 3])}
          itemSize={1}
        />
      </bufferGeometry>
      <meshBasicMaterial
        color="#ffffff"
        side={THREE.DoubleSide}
        transparent
        opacity={FACE_ALPHA}
        depthWrite={false}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EDGE STRIP — camera-facing plane strip between 2 nodes
// From straight on: looks like a line
// From rotated angle: reveals surface area
// ─────────────────────────────────────────────────────────────────────────────
function EdgeStrip({ nodeA, nodeB, getPos }) {
  const geoRef = useRef()
  const { camera } = useThree()

  const _a   = useRef(new THREE.Vector3())
  const _b   = useRef(new THREE.Vector3())
  const _dir = useRef(new THREE.Vector3())
  const _mid = useRef(new THREE.Vector3())
  const _cam = useRef(new THREE.Vector3())
  const _nor = useRef(new THREE.Vector3())
  const _up  = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!geoRef.current) return
    const pa = getPos(nodeA)
    const pb = getPos(nodeB)
    _a.current.set(pa[0], pa[1], pa[2])
    _b.current.set(pb[0], pb[1], pb[2])

    _dir.current.subVectors(_b.current, _a.current)
    const len = _dir.current.length()
    if (len < 0.001) return
    _dir.current.divideScalar(len)

    _mid.current.addVectors(_a.current, _b.current).multiplyScalar(0.5)
    _cam.current.subVectors(camera.position, _mid.current).normalize()

    _nor.current.crossVectors(_dir.current, _cam.current)
    if (_nor.current.length() < 0.001) _nor.current.set(0, 1, 0)
    _nor.current.normalize()

    _up.current.crossVectors(_nor.current, _dir.current).normalize()

    const W = EDGE_HW
    const ux = _up.current.x * W
    const uy = _up.current.y * W
    const uz = _up.current.z * W

    const p = geoRef.current.attributes.position
    p.setXYZ(0, pa[0] + ux, pa[1] + uy, pa[2] + uz)
    p.setXYZ(1, pa[0] - ux, pa[1] - uy, pa[2] - uz)
    p.setXYZ(2, pb[0] + ux, pb[1] + uy, pb[2] + uz)
    p.setXYZ(3, pb[0] - ux, pb[1] - uy, pb[2] - uz)
    p.needsUpdate = true
  })

  return (
    <mesh renderOrder={1}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute
          attach="attributes-position"
          count={4}
          array={new Float32Array(12)}
          itemSize={3}
        />
        <bufferAttribute
          attach="index"
          array={new Uint16Array([0, 1, 2, 1, 3, 2])}
          itemSize={1}
        />
      </bufferGeometry>
      <meshBasicMaterial
        color="#ffffff"
        side={THREE.DoubleSide}
        transparent
        opacity={EDGE_ALPHA}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE HANDLE — minimal draggable control point
// Small and gray — structure is the visual, not the nodes
// ─────────────────────────────────────────────────────────────────────────────
function NodeHandle({ id, getPos, onDrag, onSelect, isSelected }) {
  const { camera, gl, raycaster } = useThree()
  const meshRef   = useRef()
  const dragging  = useRef(false)
  const plane     = useRef(new THREE.Plane())
  const offset    = useRef(new THREE.Vector3())
  const hitPt     = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!meshRef.current) return
    const p = getPos(id)
    meshRef.current.position.set(p[0], p[1], p[2])
  })

  const onDown = useCallback(e => {
    e.stopPropagation()
    dragging.current = true
    onSelect(id)
    const pos = getPos(id)
    const nv = new THREE.Vector3(pos[0], pos[1], pos[2])
    const cd = new THREE.Vector3()
    camera.getWorldDirection(cd)
    plane.current.setFromNormalAndCoplanarPoint(cd, nv)
    raycaster.ray.intersectPlane(plane.current, hitPt.current)
    offset.current.subVectors(nv, hitPt.current)
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
      <sphereGeometry args={[isSelected ? 0.10 : 0.055, 12, 12]} />
      <meshBasicMaterial
        color={isSelected ? '#ffffff' : '#444444'}
        transparent
        opacity={isSelected ? 1.0 : 0.6}
      />
    </mesh>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENE — wires everything together
// ─────────────────────────────────────────────────────────────────────────────
function Scene({ posRef, nodeCount, onDrag }) {
  const controlsRef = useRef()
  const [selected, setSelected] = useState(-1)

  const getPos = useCallback(id => posRef.current[id], [posRef])

  const handleSelect = useCallback(id => {
    setSelected(id)
    if (controlsRef.current) controlsRef.current.enabled = false
  }, [])

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
        rotateSpeed={0.55}
        zoomSpeed={0.8}
        target={[0.8, 0.2, 0.8]}
      />

      {/* Ghost face planes — the spatial surfaces */}
      {FACES.map((face, i) => (
        <FacePlane key={`f${i}`} nodeIds={face} getPos={getPos} />
      ))}

      {/* Edge plane strips */}
      {EDGES.map(([a, b], i) => (
        <EdgeStrip key={`e${i}`} nodeA={a} nodeB={b} getPos={getPos} />
      ))}

      {/* Node handles — barely visible control points */}
      {Array.from({ length: nodeCount }, (_, id) => (
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
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function NodeEditor() {
  // Use ref for positions so drag updates bypass React reconciliation (smooth 60fps)
  const posRef = useRef(INIT.map(p => [...p]))

  const handleDrag = useCallback((id, newPos) => {
    posRef.current = posRef.current.map((p, i) => i === id ? newPos : p)
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Canvas
        camera={{ position: [6.5, 5.0, 8.5], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#000000']} />
        <Scene
          posRef={posRef}
          nodeCount={INIT.length}
          onDrag={handleDrag}
        />
      </Canvas>

      <div style={{
        position: 'fixed', bottom: 24, left: 24,
        color: 'rgba(255,255,255,0.14)',
        fontFamily: 'monospace', fontSize: 10.5,
        letterSpacing: '0.15em', textTransform: 'uppercase',
        pointerEvents: 'none', lineHeight: 2.0,
        userSelect: 'none',
      }}>
        <div>Drag nodes · Orbit · Scroll zoom</div>
        <div style={{ opacity: 0.4 }}>Impossible Cube Editor</div>
      </div>
    </div>
  )
}
