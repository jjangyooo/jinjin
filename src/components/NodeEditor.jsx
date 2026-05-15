import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// ── Initial graph: partial impossible cube + twisted spatial graph ──────────
const INITIAL_NODES = [
  // Cube face A (front-ish)
  { id: 0, pos: [-1.2,  1.2,  1.2] },
  { id: 1, pos: [ 1.2,  1.2,  1.2] },
  { id: 2, pos: [ 1.2, -1.2,  1.2] },
  { id: 3, pos: [-1.2, -1.2,  1.2] },
  // Cube face B (back-ish, offset twist)
  { id: 4, pos: [-1.0,  1.0, -1.2] },
  { id: 5, pos: [ 1.4,  1.0, -1.2] },
  { id: 6, pos: [ 1.0, -1.4, -1.2] },
  { id: 7, pos: [-1.4, -1.0, -1.2] },
  // Cross connectors (the "impossible" connections)
  { id: 8, pos: [  0,   1.8,  0  ] },
  { id: 9, pos: [  0,  -1.8,  0  ] },
  { id:10, pos: [ 1.8,  0,    0  ] },
  { id:11, pos: [-1.8,  0,    0  ] },
]

const INITIAL_EDGES = [
  // Front face
  [0,1],[1,2],[2,3],[3,0],
  // Back face
  [4,5],[5,6],[6,7],[7,4],
  // Cross bridges (partial, impossible-feeling)
  [0,4],[1,5],[2,6],[3,7],
  // Spatial connectors through center
  [0,8],[1,8],[4,8],[5,8],
  [2,9],[3,9],[6,9],[7,9],
  [1,10],[2,10],[5,10],[6,10],
  [0,11],[3,11],[4,11],[7,11],
]

// ── Plane Edge: renders a thin PlaneGeometry strip between two points ────────
function PlaneEdge({ startPos, endPos, camera }) {
  const meshRef = useRef()
  const geomRef = useRef()

  useFrame(() => {
    if (!meshRef.current || !geomRef.current) return

    const start = new THREE.Vector3(...startPos)
    const end   = new THREE.Vector3(...endPos)

    const dir    = new THREE.Vector3().subVectors(end, start)
    const length = dir.length()
    if (length < 0.001) return

    const dirN = dir.clone().normalize()

    // Camera-relative "up" that makes the plane face the viewer
    const camPos   = camera.position.clone()
    const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    const toCam    = new THREE.Vector3().subVectors(camPos, midPoint).normalize()

    // Plane normal = cross(edgeDir, toCam) — gives face-to-camera orientation
    let planeNorm = new THREE.Vector3().crossVectors(dirN, toCam).normalize()
    if (planeNorm.length() < 0.001) {
      planeNorm.set(0, 1, 0)
    }

    // Plane up vector = cross(planeNorm, edgeDir)
    const planeUp = new THREE.Vector3().crossVectors(planeNorm, dirN).normalize()

    // Rebuild geometry vertices
    const HALF_W = 0.025  // extremely thin width
    const pos = geomRef.current.attributes.position

    // v0 = start + planeUp * HALF_W
    const v0 = new THREE.Vector3().addVectors(start, planeUp.clone().multiplyScalar( HALF_W))
    const v1 = new THREE.Vector3().addVectors(start, planeUp.clone().multiplyScalar(-HALF_W))
    const v2 = new THREE.Vector3().addVectors(end,   planeUp.clone().multiplyScalar( HALF_W))
    const v3 = new THREE.Vector3().addVectors(end,   planeUp.clone().multiplyScalar(-HALF_W))

    pos.setXYZ(0, v0.x, v0.y, v0.z)
    pos.setXYZ(1, v1.x, v1.y, v1.z)
    pos.setXYZ(2, v2.x, v2.y, v2.z)
    pos.setXYZ(3, v3.x, v3.y, v3.z)
    pos.needsUpdate = true
    geomRef.current.computeVertexNormals()
  })

  return (
    <mesh ref={meshRef}>
      <bufferGeometry ref={geomRef}>
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
        opacity={0.92}
      />
    </mesh>
  )
}

// ── Node sphere: draggable point ─────────────────────────────────────────────
function DraggableNode({ node, onDrag, isSelected, onSelect }) {
  const meshRef = useRef()
  const { camera, gl, raycaster, scene } = useThree()
  const dragPlane = useRef(new THREE.Plane())
  const isDragging = useRef(false)
  const offset = useRef(new THREE.Vector3())

  const handlePointerDown = useCallback((e) => {
    e.stopPropagation()
    isDragging.current = true
    onSelect(node.id)

    // Build a drag plane perpendicular to camera at node position
    const nodePos = new THREE.Vector3(...node.pos)
    const camDir  = new THREE.Vector3()
    camera.getWorldDirection(camDir)
    dragPlane.current.setFromNormalAndCoplanarPoint(camDir, nodePos)

    // Compute offset from intersection to node center
    const intersection = new THREE.Vector3()
    raycaster.ray.intersectPlane(dragPlane.current, intersection)
    offset.current.subVectors(nodePos, intersection)

    gl.domElement.style.cursor = 'grabbing'
  }, [camera, gl, node, onSelect, raycaster])

  const handlePointerUp = useCallback((e) => {
    e.stopPropagation()
    isDragging.current = false
    gl.domElement.style.cursor = 'grab'
  }, [gl])

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return
    e.stopPropagation()
    const intersection = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(dragPlane.current, intersection)) {
      const newPos = intersection.add(offset.current)
      onDrag(node.id, [newPos.x, newPos.y, newPos.z])
    }
  }, [node.id, onDrag, raycaster])

  const handlePointerEnter = useCallback(() => {
    if (!isDragging.current) gl.domElement.style.cursor = 'grab'
  }, [gl])

  const handlePointerLeave = useCallback(() => {
    if (!isDragging.current) gl.domElement.style.cursor = 'default'
  }, [gl])

  return (
    <mesh
      ref={meshRef}
      position={node.pos}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <sphereGeometry args={[isSelected ? 0.10 : 0.07, 16, 16]} />
      <meshBasicMaterial
        color={isSelected ? '#ffffff' : '#888888'}
        transparent
        opacity={isSelected ? 1.0 : 0.7}
      />
    </mesh>
  )
}

// ── Scene: orchestrates all nodes + edges ────────────────────────────────────
function Scene({ nodes, edges, onDrag }) {
  const { camera } = useThree()
  const [selectedNode, setSelectedNode] = useState(null)
  const controlsRef = useRef()

  // Disable orbit while dragging a node
  const handleSelect = useCallback((id) => {
    setSelectedNode(id)
    if (controlsRef.current) controlsRef.current.enabled = false
  }, [])

  useEffect(() => {
    const onUp = () => {
      setSelectedNode(null)
      if (controlsRef.current) controlsRef.current.enabled = true
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [])

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        enablePan={true}
        enableZoom={true}
        dampingFactor={0.08}
        enableDamping
        rotateSpeed={0.6}
      />

      {/* Edges as plane strips */}
      {edges.map(([a, b], i) => {
        const nA = nodes.find(n => n.id === a)
        const nB = nodes.find(n => n.id === b)
        if (!nA || !nB) return null
        return (
          <PlaneEdge
            key={i}
            startPos={nA.pos}
            endPos={nB.pos}
            camera={camera}
          />
        )
      })}

      {/* Nodes */}
      {nodes.map(node => (
        <DraggableNode
          key={node.id}
          node={node}
          onDrag={onDrag}
          isSelected={selectedNode === node.id}
          onSelect={handleSelect}
        />
      ))}
    </>
  )
}

// ── HUD overlay ──────────────────────────────────────────────────────────────
function HUD() {
  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: 24,
      color: 'rgba(255,255,255,0.20)',
      fontFamily: 'monospace',
      fontSize: 11,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      pointerEvents: 'none',
      lineHeight: 1.7,
      userSelect: 'none',
    }}>
      <div>Drag nodes · Orbit · Scroll zoom</div>
      <div style={{ opacity: 0.5 }}>3D Node Editor</div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────
export default function NodeEditor() {
  const [nodes, setNodes] = useState(() =>
    INITIAL_NODES.map(n => ({ ...n, pos: [...n.pos] }))
  )
  const edges = INITIAL_EDGES

  const handleDrag = useCallback((id, newPos) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, pos: newPos } : n))
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Canvas
        camera={{ position: [0, 0, 7], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#000000']} />
        <Scene nodes={nodes} edges={edges} onDrag={handleDrag} />
      </Canvas>
      <HUD />
    </div>
  )
}
