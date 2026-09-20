import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Viewport } from './scene.ts'
import { getModels, getSelected, select, subscribe } from './scene-store.ts'

export type TransformTools = {
  gizmo: TransformControls
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

  return { gizmo }
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
