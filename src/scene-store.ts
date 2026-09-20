import type { Object3D } from 'three'

// Where a model came from. This matters when we emit the snippet: a 'library'
// model already lives at a path the real site can load, a 'dropped' one is a
// blob URL that only exists in this tab, and a 'primitive' one is scratch
// geometry with no file behind it at all.
export type ModelOrigin = 'library' | 'dropped' | 'primitive'

export type Transform = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export type SceneModel = {
  id: string
  /** File name as shown in the panel, e.g. 'jacket.glb'. */
  name: string
  /** Path the snippet should emit, e.g. '/models/jacket.glb'. */
  src: string
  origin: ModelOrigin
  /**
   * The live object in the scene. Null for a row restored from localStorage
   * whose file we cannot reach any more — a dropped blob URL dies with the page,
   * so the row survives as a reminder to re-drop the file rather than silently
   * dropping the transform we spent time getting right.
   */
  object: Object3D | null
  /** Transform kept for rows with no object, so the snippet still includes them. */
  savedTransform?: Transform
  /** Set when the model's native size suggests the wrong export units. */
  unitWarning?: string
}

const models: SceneModel[] = []
let selectedId: string | null = null
let idCounter = 0

const listeners = new Set<() => void>()

/**
 * Subscribes to structural changes: models added or removed, selection moved,
 * visibility toggled. Transforms are deliberately NOT part of this — the panel
 * reads those straight off the Object3D every frame, so the gizmo and the
 * number fields can never disagree about where something is.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function getModels(): readonly SceneModel[] {
  return models
}

export function getModel(id: string): SceneModel | undefined {
  return models.find((model) => model.id === id)
}

export function getSelected(): SceneModel | null {
  return selectedId === null ? null : getModel(selectedId) ?? null
}

export function nextId(): string {
  idCounter += 1
  return `m${idCounter}`
}

export function addModel(model: SceneModel): void {
  models.push(model)
  // Keep ids unique across a restore, where models arrive with ids we did not
  // mint ourselves.
  const numeric = Number(model.id.replace(/^m/, ''))
  if (Number.isFinite(numeric)) idCounter = Math.max(idCounter, numeric)
  emit()
}

export function removeModel(id: string): SceneModel | undefined {
  const index = models.findIndex((model) => model.id === id)
  if (index === -1) return undefined
  const [removed] = models.splice(index, 1)
  if (selectedId === id) selectedId = null
  emit()
  return removed
}

export function clearModels(): SceneModel[] {
  const removed = models.splice(0, models.length)
  selectedId = null
  emit()
  return removed
}

export function select(id: string | null): void {
  // A row with no object has nothing for the gizmo to attach to.
  if (id !== null && !getModel(id)?.object) return
  if (selectedId === id) return
  selectedId = id
  emit()
}

/** Signals a change the store does not own, e.g. a visibility toggle. */
export function touch(): void {
  emit()
}
