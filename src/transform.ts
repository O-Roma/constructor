import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { measureLocal } from './loader.ts'
import type { Viewport } from './scene.ts'
import { getModels, getSelected, select, subscribe } from './scene-store.ts'

export type TransformTools = {
  gizmo: TransformControls
  /** While on, a scale drag or a typed scale value changes all three axes together. */
  isProportional(): boolean
  setProportional(value: boolean): void
  /** Lets the panel checkbox follow the L hotkey. */
  onProportionalChange(listener: (value: boolean) => void): () => void
  /** Scales the object so its largest dimension measures `metres`. */
  resize(object: THREE.Object3D, metres: number): void
}

/** How far the pointer may travel and still count as a click rather than an orbit. */
const CLICK_SLOP_PX = 4

export function createTransformTools(viewport: Viewport, onRemoveSelected: () => void): TransformTools {
  const { camera, canvas, controls, scene } = viewport

  const gizmo = new TransformControls(camera, canvas)
  gizmo.setSpace('world')
  // Since three r169 the visual part of the gizmo is a separate helper object;
  // adding the controls themselves to the scene draws nothing.
  scene.add(gizmo.getHelper())

  // Without this the gizmo drag also spins the camera, which makes precise
  // placement impossible.
  gizmo.addEventListener('dragging-changed', (event) => {
    controls.enabled = !(event.value as boolean)
  })

  // ── Proportional scaling ─────────────────────────────────────────────
  // On by default: a model stretched on one axis only is almost always a
  // mistake, and the axis handles are far easier to grab than the centre box
  // that scales uniformly.
  let proportional = true
  const proportionalListeners = new Set<(value: boolean) => void>()

  function setProportional(value: boolean): void {
    if (proportional === value) return
    proportional = value
    for (const listener of proportionalListeners) listener(value)
  }

  // Captured on pointer-down because TransformControls recomputes the scale from
  // its own start value on every move; overriding the result is therefore safe
  // and never compounds.
  const scaleAtDragStart = new THREE.Vector3()
  gizmo.addEventListener('mouseDown', () => {
    if (gizmo.object) scaleAtDragStart.copy(gizmo.object.scale)
  })

  gizmo.addEventListener('objectChange', () => {
    const object = gizmo.object
    if (!proportional || gizmo.mode !== 'scale' || !object) return

    // Whichever handle was grabbed, the axis that has moved furthest from where
    // the drag started is the one the user is expressing; the others follow it
    // by the same ratio, so the proportions survive.
    let ratio = 1
    for (const axis of ['x', 'y', 'z'] as const) {
      const from = scaleAtDragStart[axis]
      if (from === 0) continue
      const candidate = object.scale[axis] / from
      if (Math.abs(Math.log(candidate)) > Math.abs(Math.log(ratio))) ratio = candidate
    }

    object.scale.copy(scaleAtDragStart).multiplyScalar(ratio)
  })

  subscribe(() => {
    const selected = getSelected()
    if (selected?.object) gizmo.attach(selected.object)
    else gizmo.detach()
  })

  // ── Click to select ──────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let downX = 0
  let downY = 0

  canvas.addEventListener('pointerdown', (event) => {
    downX = event.clientX
    downY = event.clientY
  })

  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return
    // Orbiting ends in a pointerup too; treating that as a click would deselect
    // whatever the user is working on every time they move the camera.
    const travelled = Math.hypot(event.clientX - downX, event.clientY - downY)
    if (travelled > CLICK_SLOP_PX) return
    // A release that ends a gizmo drag is not a selection change either.
    if (gizmo.dragging) return

    pointer.x = (event.clientX / window.innerWidth) * 2 - 1
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
    raycaster.setFromCamera(pointer, camera)

    // Only the content group is tested, so the grid and axes are never picked.
    const hits = raycaster.intersectObjects(viewport.content.children, true)
    select(hits.length > 0 ? findModelId(hits[0].object) : null)
  })

  // ── Hotkeys ──────────────────────────────────────────────────────────
  window.addEventListener('keydown', (event) => {
    // Typing an exact value in the panel must not also switch gizmo modes.
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return
    if (event.metaKey || event.ctrlKey || event.altKey) return

    switch (event.key.toLowerCase()) {
      case 'w':
        gizmo.setMode('translate')
        break
      case 'e':
        gizmo.setMode('rotate')
        break
      case 'r':
        gizmo.setMode('scale')
        break
      case 'l':
        setProportional(!proportional)
        break
      case 'x':
        gizmo.setSpace(gizmo.space === 'world' ? 'local' : 'world')
        break
      case 'g':
        viewport.helpers.visible = !viewport.helpers.visible
        break
      case 'escape':
        select(null)
        break
      case 'delete':
      case 'backspace':
        if (getSelected()) {
          event.preventDefault()
          onRemoveSelected()
        }
        break
      default:
        break
    }
  })

  return {
    gizmo,
    isProportional: () => proportional,
    setProportional,
    onProportionalChange(listener) {
      proportionalListeners.add(listener)
      return () => proportionalListeners.delete(listener)
    },
    resize(object, metres) {
      const size = measureLocal(object).multiply(object.scale)
      const largest = Math.max(size.x, size.y, size.z)
      if (!Number.isFinite(largest) || largest <= 0 || metres <= 0) return
      // Multiplying keeps any deliberate non-uniform scale intact.
      object.scale.multiplyScalar(metres / largest)
    },
  }
}

/**
 * Raycasting hits the individual mesh deep inside a GLTF hierarchy, but the
 * thing we move — and the thing the panel knows about — is the root we added.
 */
function findModelId(hit: THREE.Object3D): string | null {
  const roots = new Map(getModels().filter((model) => model.object).map((model) => [model.object!, model.id]))

  let node: THREE.Object3D | null = hit
  while (node) {
    const id = roots.get(node)
    if (id !== undefined) return id
    node = node.parent
  }
  return null
}
