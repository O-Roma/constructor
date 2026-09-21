import type { BackgroundController, BackgroundOrigin, BackgroundSettings } from './background.ts'
import type { Viewport } from './scene.ts'
import { getModels, type ModelOrigin, type Transform } from './scene-store.ts'
import { readTransform } from './snippet.ts'

const STORAGE_KEY = 'constructor3d.scene.v1'

export type SavedModel = {
  id: string
  name: string
  src: string
  origin: ModelOrigin
  transform: Transform
  visible: boolean
}

export type SavedBackground = {
  name: string
  src: string
  origin: BackgroundOrigin
  settings: BackgroundSettings
}

export type SavedScene = {
  camera: {
    position: [number, number, number]
    target: [number, number, number]
    fov: number
  }
  models: SavedModel[]
  background: SavedBackground | null
}

/**
 * The arrangement is the work here, so losing it to an accidental refresh would
 * throw away an afternoon. Library models come back on their own; dropped ones
 * cannot, because a blob URL dies with the page — those return as placeholder
 * rows holding their transform until the file is re-dropped.
 */
export function saveScene(viewport: Viewport, background: BackgroundController): void {
  const { camera, controls } = viewport
  const image = background.getImage()

  const scene: SavedScene = {
    background: image
      ? { name: image.name, src: image.src, origin: image.origin, settings: background.getSettings() }
      : null,
    camera: {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      fov: camera.fov,
    },
    models: getModels().map((model) => ({
      id: model.id,
      name: model.name,
      src: model.src,
      origin: model.origin,
      transform: readTransform(model),
      visible: model.object?.visible ?? true,
    })),
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene))
  } catch {
    // Private windows and a full quota both throw. Losing the autosave is worth
    // far less than crashing the render loop over it.
  }
}

export function loadScene(): SavedScene | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedScene
    if (!Array.isArray(parsed.models)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSavedScene(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do if storage is unavailable.
  }
}

/**
 * Returns a function that marks the scene dirty; the actual write happens on a
 * timer, at most once a second.
 *
 * This is a throttle and not a debounce on purpose. A gizmo drag changes the
 * transform every frame, and a debounce that restarts on every call would keep
 * pushing the write into the future and never save at all while the render loop
 * is running.
 */
export function createAutosave(viewport: Viewport, background: BackgroundController): () => void {
  let dirty = false

  setInterval(() => {
    if (!dirty) return
    dirty = false
    saveScene(viewport, background)
  }, 1000)

  return () => {
    dirty = true
  }
}

export function applyCamera(viewport: Viewport, camera: SavedScene['camera']): void {
  viewport.camera.position.set(...camera.position)
  viewport.camera.fov = camera.fov
  viewport.camera.updateProjectionMatrix()
  viewport.controls.target.set(...camera.target)
  viewport.controls.update()
}

export function applyTransform(object: { position: Vec3Like; rotation: Vec3Like; scale: Vec3Like }, transform: Transform): void {
  object.position.set(...transform.position)
  object.rotation.set(...transform.rotation)
  object.scale.set(...transform.scale)
}

type Vec3Like = { set(x: number, y: number, z: number): unknown }
