import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type Viewport = {
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  /** Grid + axes, toggled with G. Kept out of the way of raycast picking. */
  helpers: THREE.Group
  /** Everything the user places goes in here, so picking never hits a helper. */
  content: THREE.Group
  onFrame(callback: () => void): void
}

export function createViewport(canvas: HTMLCanvasElement): Viewport {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0c0c0d)

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000)
  camera.position.set(3, 2, 4)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0.5, 0)

  // ── Lighting ─────────────────────────────────────────────────────────
  // Neutral and flat on purpose. The point of this scene is judging position
  // and scale, and a dramatic key light makes it much harder to tell where
  // something actually sits on the ground.
  scene.add(new THREE.AmbientLight(0xffffff, 0.8))

  const key = new THREE.DirectionalLight(0xffffff, 2)
  key.position.set(4, 6, 3)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0x9db4ff, 0.6)
  fill.position.set(-5, 2, -3)
  scene.add(fill)

  // ── Helpers ──────────────────────────────────────────────────────────
  // One metre per grid square, so the numbers in the panel can be read off the
  // floor at a glance.
  const helpers = new THREE.Group()
  const grid = new THREE.GridHelper(20, 20, 0x3a3a42, 0x22222a)
  helpers.add(grid, new THREE.AxesHelper(1))
  scene.add(helpers)

  const content = new THREE.Group()
  scene.add(content)

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  const frameCallbacks: Array<() => void> = []

  function tick(): void {
    controls.update()
    for (const callback of frameCallbacks) callback()
    renderer.render(scene, camera)
  }

  renderer.setAnimationLoop(tick)

  return {
    canvas,
    renderer,
    scene,
    camera,
    controls,
    helpers,
    content,
    onFrame(callback) {
      frameCallbacks.push(callback)
    },
  }
}
