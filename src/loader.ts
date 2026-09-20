import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

export async function loadGltf(url: string): Promise<THREE.Object3D> {
  const gltf = await loader.loadAsync(url)
  const object = gltf.scene

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })

  return object
}

/**
 * Models are loaded at their NATIVE scale, unlike situ-web which fits its single
 * model into a fixed box. Auto-fitting each model here would destroy the
 * relative sizes between garments, which is most of what we are trying to judge.
 * The cost is that a badly exported model can arrive in centimetres or inches,
 * so we flag it instead of silently correcting it.
 */
export function describeUnits(object: THREE.Object3D): string | undefined {
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
  const largest = Math.max(size.x, size.y, size.z)

  if (!Number.isFinite(largest) || largest === 0) return 'empty or degenerate geometry'
  if (largest > 50) return `${largest.toFixed(0)}m across — exported in cm?`
  if (largest < 0.05) return `${(largest * 100).toFixed(1)}cm across — exported in km?`
  return undefined
}

/**
 * Sits the object on the floor at the given spot. Models rarely have their
 * origin at the sole, so dropping one in at y = 0 usually buries half of it.
 */
export function placeOnGround(object: THREE.Object3D, x: number, z: number): void {
  object.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(object)
  object.position.set(x, -box.min.y, z)
}

/**
 * Where the next model should land. Successive additions step along a spiral so
 * they do not stack invisibly on top of each other at the origin.
 */
export function nextSpot(index: number): [number, number] {
  if (index === 0) return [0, 0]
  const angle = index * 2.4 // ~137°, so the ring fills in evenly rather than in spokes
  const radius = 0.6 + index * 0.35
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

/** Scratch geometry for checking the playground works with no assets at all. */
export function createTestCube(): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xc8f560, roughness: 0.5 }),
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Frees GPU memory for a model we are removing. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) material.dispose()
  })
}
