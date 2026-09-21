import { createBackground } from './background.ts'
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

/**
 * What a fresh session opens on. `playa.jpeg` is an ordinary 4:3 photo rather
 * than a 360° panorama, so its skyline sits well above the viewer until the
 * horizon offset pulls it down to eye level — hence the value here.
 */
const DEFAULT_BACKGROUND = { file: 'playa.jpeg', horizon: 0.42 }

const MODELS_URL_PREFIX = '/models/'
const BACKGROUNDS_URL_PREFIX = '/backgrounds/'
const MANIFEST_URL = '/asset-manifest.json'

const canvas = document.getElementById('viewport')
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #viewport canvas')

const viewport = createViewport(canvas)
const background = createBackground(viewport)
const autosave = createAutosave(viewport, background)

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

/**
 * `src` is the path the snippet emits; `url` is what we actually fetch. They
 * differ for a dropped file, whose bytes only exist as a blob in this tab.
 */
function setBackground(name: string, src: string, url: string, origin: 'library' | 'dropped'): void {
  background.set({ name, src, origin }, url).catch((error: unknown) => {
    console.error(`could not load backdrop ${name}`, error)
    window.alert(`Could not load ${name}. See the console for details.`)
  })
}

function setBackgroundFromLibrary(fileName: string): void {
  const src = BACKGROUNDS_URL_PREFIX + encodeURIComponent(fileName)
  setBackground(fileName, src, src, 'library')
}

function setDroppedBackground(file: File): void {
  const url = URL.createObjectURL(file)
  const src = BACKGROUNDS_URL_PREFIX + encodeURIComponent(file.name)
  setBackground(file.name, src, url, 'dropped')
  // Not revoked immediately: unlike a GLTF, which is fully parsed into geometry
  // by the time the promise settles, the texture keeps reading from this URL.
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

const tools = createTransformTools(viewport, () => {
  const selected = getSelected()
  if (selected) removeById(selected.id)
})

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

const hooks: PanelHooks = {
  addFromLibrary,
  setBackgroundFromLibrary,
  addTestCube,
  removeModel: removeById,
  clearScene,
  async listLibrary() {
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' })
      if (!response.ok) return { models: [], backgrounds: [] }
      const manifest = (await response.json()) as { models?: unknown; backgrounds?: unknown }
      return { models: stringList(manifest.models), backgrounds: stringList(manifest.backgrounds) }
    } catch {
      return { models: [], backgrounds: [] }
    }
  },
}

const panel = createPanel(viewport, background, tools, hooks)

subscribe(autosave)
background.subscribe(autosave)
viewport.controls.addEventListener('change', autosave)
// A gizmo drag mutates the object directly, so nothing in the store fires —
// save off the render loop instead, which the debounce keeps cheap.
viewport.onFrame(autosave)

// ── Drag & drop ────────────────────────────────────────────────────────

const MODEL_EXT = /\.(glb|gltf)$/i
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|hdr)$/i

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

  const files = [...(event.dataTransfer?.files ?? [])]
  for (const file of files) {
    if (MODEL_EXT.test(file.name)) addDroppedFile(file)
    // Only the last image wins — there is one backdrop.
    else if (IMAGE_EXT.test(file.name)) setDroppedBackground(file)
  }
})

// ── Restore the previous session ───────────────────────────────────────

const saved = loadScene()
if (saved) {
  applyCamera(viewport, saved.camera)

  if (saved.background) {
    const { name, src, origin, settings } = saved.background
    if (origin === 'library') {
      background.set({ name, src, origin }, src).then(
        () => background.update(settings),
        // Renamed or deleted since we saved — keep the settings so the sliders
        // are not reset to nothing.
        () => background.setMissing({ name, src, origin }, settings),
      )
    } else {
      // A dropped image's blob URL died with the page.
      background.setMissing({ name, src, origin }, settings)
    }
  }

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
} else {
  // Nothing saved yet, so open on the default backdrop. It is skipped silently
  // when the file is not there, since the library is git-ignored and a fresh
  // clone has none of it.
  const src = BACKGROUNDS_URL_PREFIX + DEFAULT_BACKGROUND.file
  background
    .set({ name: DEFAULT_BACKGROUND.file, src, origin: 'library' }, src)
    .then(() => background.update({ horizon: DEFAULT_BACKGROUND.horizon }))
    .catch(() => background.clear())
}
