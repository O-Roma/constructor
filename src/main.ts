import { createPanel, type PanelHooks } from './panel.ts'
import { applyCamera, applyTransform, clearSavedScene, createAutosave, loadScene } from './persist.ts'
import { createTestCube, describeUnits, disposeObject, loadGltf, nextSpot, placeOnGround } from './loader.ts'
import { createViewport } from './scene.ts'
import { createTransformTools } from './transform.ts'
import {
  addModel,
  clearModels,
  getModels,
  getSelected,
  nextId,
  removeModel,
  select,
  subscribe,
  type SceneModel,
} from './scene-store.ts'

const MODELS_URL_PREFIX = '/models/'
const MANIFEST_URL = '/models-manifest.json'

const canvas = document.getElementById('viewport')
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #viewport canvas')

const viewport = createViewport(canvas)
const autosave = createAutosave(viewport)

// ── Adding models ──────────────────────────────────────────────────────

function register(model: SceneModel): void {
  if (model.object) viewport.content.add(model.object)
  addModel(model)
  if (model.object) select(model.id)
}

/**
 * Loads a GLTF and places it on the floor near the orbit target. `src` is what
 * the snippet will emit; `url` is what the loader actually fetches — the two
 * differ for a dropped file, whose bytes only exist as a blob in this tab.
 */
async function addGltf(name: string, src: string, url: string, origin: SceneModel['origin']): Promise<void> {
  try {
    const object = await loadGltf(url)
    const [x, z] = nextSpot(getModels().length)
    placeOnGround(object, viewport.controls.target.x + x, viewport.controls.target.z + z)

    register({
      id: nextId(),
      name,
      src,
      origin,
      object,
      unitWarning: describeUnits(object),
    })
  } catch (error) {
    console.error(`could not load ${name}`, error)
    window.alert(`Could not load ${name}. See the console for details.`)
  }
}

function addFromLibrary(fileName: string): void {
  const src = MODELS_URL_PREFIX + encodeURIComponent(fileName)
  void addGltf(fileName, src, src, 'library')
}

function addDroppedFile(file: File): void {
  const url = URL.createObjectURL(file)
  // The snippet points at where the file *should* live, since the blob URL is
  // meaningless to anything but this tab.
  const src = MODELS_URL_PREFIX + encodeURIComponent(file.name)
  void addGltf(file.name, src, url, 'dropped').finally(() => URL.revokeObjectURL(url))
}

function addTestCube(): void {
  const object = createTestCube()
  const [x, z] = nextSpot(getModels().length)
  placeOnGround(object, viewport.controls.target.x + x, viewport.controls.target.z + z)
  register({ id: nextId(), name: 'test cube', src: '', origin: 'primitive', object })
}

// ── Removing models ────────────────────────────────────────────────────

function discard(model: SceneModel): void {
  if (!model.object) return
  viewport.content.remove(model.object)
  disposeObject(model.object)
}

function removeById(id: string): void {
  const removed = removeModel(id)
  if (removed) discard(removed)
}

function clearScene(): void {
  for (const model of clearModels()) discard(model)
  clearSavedScene()
}

// ── Wiring ─────────────────────────────────────────────────────────────

createTransformTools(viewport, () => {
  const selected = getSelected()
  if (selected) removeById(selected.id)
})

const hooks: PanelHooks = {
  addFromLibrary,
  addTestCube,
  removeModel: removeById,
  clearScene,
  async listLibrary() {
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' })
      if (!response.ok) return []
      const files = (await response.json()) as unknown
      return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : []
    } catch {
      return []
    }
  },
}

const panel = createPanel(viewport, hooks)

subscribe(autosave)
viewport.controls.addEventListener('change', autosave)
// A gizmo drag mutates the object directly, so nothing in the store fires —
// save off the render loop instead, which the debounce keeps cheap.
viewport.onFrame(autosave)

// ── Drag & drop ────────────────────────────────────────────────────────

const MODEL_EXT = /\.(glb|gltf)$/i

window.addEventListener('dragover', (event) => {
  event.preventDefault()
  document.body.classList.add('dragging')
})

window.addEventListener('dragleave', (event) => {
  // Fires for children too; only the drag actually leaving the window counts.
  if (event.relatedTarget === null) document.body.classList.remove('dragging')
})

window.addEventListener('drop', (event) => {
  event.preventDefault()
  document.body.classList.remove('dragging')

  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => MODEL_EXT.test(file.name))
  if (files.length === 0) return
  for (const file of files) addDroppedFile(file)
})

// ── Restore the previous session ───────────────────────────────────────

const saved = loadScene()
if (saved) {
  applyCamera(viewport, saved.camera)

  for (const entry of saved.models) {
    if (entry.origin === 'library') {
      void loadGltf(entry.src)
        .then((object) => {
          applyTransform(object, entry.transform)
          object.visible = entry.visible
          viewport.content.add(object)
          addModel({ ...entry, object, unitWarning: describeUnits(object) })
        })
        .catch(() => {
          // The file was renamed or deleted since we saved. Keep the row so the
          // transform is not lost.
          addModel({ ...entry, object: null, savedTransform: entry.transform })
        })
      continue
    }

    if (entry.origin === 'primitive') {
      const object = createTestCube()
      applyTransform(object, entry.transform)
      object.visible = entry.visible
      viewport.content.add(object)
      addModel({ ...entry, object })
      continue
    }

    // A dropped file's blob URL died with the page, so this comes back as a
    // placeholder row asking for the file again.
    addModel({ ...entry, object: null, savedTransform: entry.transform })
  }

  void panel.refreshLibrary()
}
