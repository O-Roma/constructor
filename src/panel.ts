import { Box3, Vector3 } from 'three'
import type { BackgroundController } from './background.ts'
import { measureLocal } from './loader.ts'
import type { Viewport } from './scene.ts'
import type { TransformTools } from './transform.ts'
import type { AssetKind } from './uploads.ts'
import {
  getModels,
  getSelected,
  select,
  subscribe,
  touch,
  type SceneModel,
} from './scene-store.ts'
import { buildSnippet, copyToClipboard } from './snippet.ts'

/** One file the panel can offer, whether it ships with the site or was uploaded. */
export type LibraryEntry = {
  name: string
  /** Where to fetch it: a path under the site, or a Blob URL. */
  url: string
  /** True for an uploaded file, which everyone opening the site can also see. */
  remote: boolean
}

export type Library = {
  models: LibraryEntry[]
  backgrounds: LibraryEntry[]
  /** False when the deployment has no Blob store or no upload password set. */
  uploads: boolean
}

export type PanelHooks = {
  addFromLibrary(entry: LibraryEntry): void
  setBackgroundFromLibrary(entry: LibraryEntry): void
  addTestCube(): void
  removeModel(id: string): void
  clearScene(): void
  /** Re-reads both the bundled files and the uploaded ones. */
  listLibrary(): Promise<Library>
  /** Sends a file to the shared library. Rejects if the password is wrong. */
  upload(file: File, kind: AssetKind): Promise<void>
}

type Axis = 'x' | 'y' | 'z'
type Channel = 'position' | 'rotation' | 'scale'

const AXES: Axis[] = ['x', 'y', 'z']

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id} in index.html`)
  return node as T
}

function fmt(value: number): string {
  return value.toFixed(3)
}

export type Panel = {
  /** Re-reads public/models and redraws the library list. */
  refreshLibrary(): Promise<void>
}

export function createPanel(
  viewport: Viewport,
  background: BackgroundController,
  tools: TransformTools,
  hooks: PanelHooks,
): Panel {
  const panel = must('panel')
  const cameraReadout = must('camera-readout')
  const libraryList = must('library-list')
  const backgroundList = must('background-list')
  const backgroundControls = must('background-controls')
  const modelList = must('model-list')
  const selectedBody = must('selected-body')
  const copyStatus = must('copy-status')

  // ── Panel chrome ─────────────────────────────────────────────────────
  const toggle = must<HTMLButtonElement>('panel-toggle')
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed')
    toggle.textContent = collapsed ? '+' : '–'
  })

  // H hides the panel outright, for judging the composition without a slab of
  // numbers covering a third of the frame.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return
    if (event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey) {
      panel.hidden = !panel.hidden
    }
  })

  // ── Library ──────────────────────────────────────────────────────────
  function pickerRows(
    entries: LibraryEntry[],
    emptyHint: string,
    action: string,
    onPick: (entry: LibraryEntry) => void,
    activeName?: string,
  ): HTMLElement[] {
    if (entries.length === 0) return [el('div', 'muted', emptyHint)]

    return entries.map((entry) => {
      const row = el('div', 'item')
      if (entry.name === activeName) row.classList.add('selected')
      const name = el('span', 'item-name', entry.name)
      // Where a file actually comes from only matters when something is wrong,
      // so it lives in the tooltip rather than taking up a column.
      name.title = entry.remote ? `uploaded · ${entry.url}` : entry.url
      row.append(name)
      // Uploaded files are the ones every visitor sees, which is worth saying
      // out loud next to ones that merely sit in this checkout.
      if (entry.remote) row.append(el('span', 'tag', 'shared'))
      row.append(el('span', 'item-id', entry.name === activeName ? 'in use' : action))
      row.addEventListener('click', () => onPick(entry))
      return row
    })
  }

  // Upload buttons are hidden until the library tells us the deployment can
  // actually take one, so `vite dev` never offers a button that cannot work.
  const uploadButtons = [
    { button: must<HTMLButtonElement>('library-upload'), kind: 'models' as AssetKind },
    { button: must<HTMLButtonElement>('background-upload'), kind: 'backgrounds' as AssetKind },
  ]

  async function refreshLibrary(): Promise<void> {
    libraryList.replaceChildren(el('div', 'muted', 'reading the library…'))
    const { models, backgrounds, uploads } = await hooks.listLibrary()

    for (const { button } of uploadButtons) button.hidden = !uploads

    libraryList.replaceChildren(
      ...pickerRows(models, 'nothing here yet — drop a .glb on the canvas', 'add', hooks.addFromLibrary),
    )
    backgroundList.replaceChildren(
      ...pickerRows(
        backgrounds,
        'nothing here yet — drop an image on the canvas',
        'use',
        hooks.setBackgroundFromLibrary,
        background.getImage()?.name,
      ),
    )
  }

  const ACCEPT: Record<AssetKind, string> = {
    models: '.glb,.gltf',
    backgrounds: '.jpg,.jpeg,.png,.webp,.avif,.hdr',
  }

  function pickAndUpload(kind: AssetKind, list: HTMLElement): void {
    const input = el('input')
    input.type = 'file'
    input.accept = ACCEPT[kind]
    input.multiple = true

    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])]
      if (files.length === 0) return

      // One status line per list, so a second attempt replaces the first
      // instead of stacking old failures under the new one.
      for (const stale of list.querySelectorAll('.upload-status')) stale.remove()
      const status = el('div', 'muted upload-status', '')
      list.append(status)

      for (const file of files) {
        status.textContent = `uploading ${file.name}…`
        try {
          await hooks.upload(file, kind)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message === 'cancelled') break
          status.className = 'warn upload-status'
          status.textContent = `${file.name}: ${message}`
          return
        }
      }

      await refreshLibrary()
    })

    input.click()
  }

  uploadButtons[0].button.addEventListener('click', () => pickAndUpload('models', libraryList))
  uploadButtons[1].button.addEventListener('click', () => pickAndUpload('backgrounds', backgroundList))

  // ── Background controls ──────────────────────────────────────────────
  function slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
    onChange: (value: number) => void,
    onRelease = false,
  ): HTMLElement {
    const row = el('div', 'row')
    row.append(el('span', 'slider-label', label))

    const input = el('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)

    const readout = el('span', 'slider-value', format(value))
    input.addEventListener('input', () => {
      const next = Number(input.value)
      readout.textContent = format(next)
      // The readout still tracks the drag; only the expensive work waits.
      if (!onRelease) onChange(next)
    })
    if (onRelease) input.addEventListener('change', () => onChange(Number(input.value)))

    row.append(input, readout)
    return row
  }

  function renderBackgroundControls(): void {
    const image = background.getImage()

    if (!image) {
      backgroundControls.replaceChildren()
      return
    }

    const settings = background.getSettings()
    const nodes: HTMLElement[] = []

    if (!image.loaded) {
      nodes.push(el('div', 'warn', `re-drop ${image.name}`))
    } else if (image.origin === 'dropped') {
      // A dropped file has no row in the library list, so this is the only
      // place its name appears.
      nodes.push(el('div', 'muted', image.name))
    }

    nodes.push(
      // Only the vertical axis is exposed. Tilting a panorama on X or Z throws
      // the horizon off level, which is never what we want here.
      slider(
        'spin',
        (settings.rotationY * 180) / Math.PI,
        -180,
        180,
        1,
        (value) => `${value.toFixed(0)}°`,
        (value) => background.update({ rotationY: (value * Math.PI) / 180 }),
      ),
    )

    // A true 2:1 panorama already has its horizon in the right place; the
    // slider would only break it.
    if (!image.panoramic) {
      nodes.push(
        slider(
          'horizon',
          settings.horizon,
          -0.5,
          0.5,
          0.01,
          (value) => `${(value * 100).toFixed(0)}%`,
          (value) => background.update({ horizon: value }),
          true,
        ),
      )
    }

    nodes.push(
      slider('blur', settings.blur, 0, 1, 0.01, (value) => value.toFixed(2), (value) =>
        background.update({ blur: value }),
      ),
      slider('bright', settings.intensity, 0, 3, 0.05, (value) => value.toFixed(2), (value) =>
        background.update({ intensity: value }),
      ),
    )

    const lightingRow = el('div', 'row')
    const lighting = el('input')
    lighting.type = 'checkbox'
    lighting.id = 'background-lighting'
    lighting.checked = settings.lighting
    lighting.addEventListener('change', () => background.update({ lighting: lighting.checked }))

    const lightingLabel = el('label', undefined, 'light the models with it')
    lightingLabel.htmlFor = lighting.id
    lightingLabel.style.cursor = 'pointer'

    lightingRow.append(lighting, lightingLabel)
    lightingRow.style.marginTop = '6px'
    nodes.push(lightingRow)

    backgroundControls.replaceChildren(...nodes)
  }

  function markActiveBackground(): void {
    const activeName = background.getImage()?.name
    for (const row of backgroundList.querySelectorAll('.item')) {
      const name = row.querySelector('.item-name')?.textContent
      const isActive = name === activeName
      row.classList.toggle('selected', isActive)
      const action = row.querySelector('.item-id')
      if (action) action.textContent = isActive ? 'in use' : 'use'
    }
  }

  must<HTMLButtonElement>('background-clear').addEventListener('click', () => background.clear())
  // Rebuilt wholesale rather than patched, so a restored session shows the saved
  // slider positions without a separate sync path.
  background.subscribe(() => {
    renderBackgroundControls()
    markActiveBackground()
  })
  renderBackgroundControls()

  must<HTMLButtonElement>('library-refresh').addEventListener('click', () => void refreshLibrary())
  must<HTMLButtonElement>('add-cube').addEventListener('click', () => hooks.addTestCube())
  void refreshLibrary()

  // ── Scene contents ───────────────────────────────────────────────────
  function renderModelList(): void {
    const models = getModels()
    if (models.length === 0) {
      modelList.replaceChildren(el('div', 'muted', 'nothing placed yet'))
      return
    }

    const selectedId = getSelected()?.id
    modelList.replaceChildren(...models.map((model) => modelRow(model, model.id === selectedId)))
  }

  function modelRow(model: SceneModel, isSelected: boolean): HTMLElement {
    const row = el('div', 'item')
    if (isSelected) row.classList.add('selected')
    if (!model.object) row.classList.add('missing')

    const name = el('span', 'item-name', model.name)
    if (!model.object) name.textContent = `re-drop ${model.name}`
    name.title = model.src
    row.append(name)
    row.append(el('span', 'item-id', model.id))

    if (model.object) {
      const object = model.object
      const visibility = el('button', 'icon', object.visible ? '●' : '○')
      visibility.title = 'Show / hide'
      visibility.addEventListener('click', (event) => {
        event.stopPropagation()
        object.visible = !object.visible
        touch()
      })
      row.append(visibility)
      row.addEventListener('click', () => select(model.id))
    }

    const remove = el('button', 'icon', '×')
    remove.title = 'Remove'
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      hooks.removeModel(model.id)
    })
    row.append(remove)

    return row
  }

  // ── Selected model fields ────────────────────────────────────────────
  // Rebuilt only when the selection changes; the values are written every frame
  // by updateFields so a gizmo drag is reflected live.
  let fields: Array<{ input: HTMLInputElement; channel: Channel; axis: Axis }> = []
  // The model's exported width/height/depth, measured once per selection since
  // geometry never changes under us. Multiplied by the scale it gives the size
  // the model currently reads as in the scene.
  let baseSize: Vector3 | null = null
  let sizeInput: HTMLInputElement | null = null
  let lockBox: HTMLInputElement | null = null

  function currentSize(object: { scale: Vector3 }): number {
    if (!baseSize) return 0
    const scaled = baseSize.clone().multiply(object.scale)
    return Math.max(scaled.x, scaled.y, scaled.z)
  }

  // The hotkey and the checkbox are two views of the same switch.
  tools.onProportionalChange((value) => {
    if (lockBox) lockBox.checked = value
  })

  function renderSelected(): void {
    const selected = getSelected()
    fields = []

    if (!selected?.object) {
      selectedBody.replaceChildren(el('div', 'muted', 'click a model in the scene'))
      return
    }

    const object = selected.object
    baseSize = measureLocal(object)
    sizeInput = null
    lockBox = null
    const nodes: HTMLElement[] = [el('div', 'muted', `${selected.name}  ·  ${selected.id}`)]

    if (selected.unitWarning) {
      nodes.push(el('div', 'warn', `⚠ ${selected.unitWarning}`))
    }

    // Size before the raw scale factors: how many metres across a model is
    // the question we are actually asking, and a scale of 1.4 answers it only if
    // you already remember what the model was exported at.
    const sizeGroup = el('div', 'field compact')
    sizeGroup.append(el('label', undefined, 'size'))

    const size = el('input')
    size.type = 'number'
    size.step = '0.05'
    size.min = '0'
    size.title = 'Largest dimension in metres — typing here rescales the whole model'
    size.addEventListener('input', () => {
      const typed = Number(size.value)
      if (!Number.isFinite(typed) || typed <= 0) return
      tools.resize(object, typed)
    })
    sizeGroup.append(size, el('span', 'unit', 'm'))
    sizeInput = size
    nodes.push(sizeGroup)

    for (const channel of ['position', 'rotation', 'scale'] as Channel[]) {
      const group = el('div', 'field')
      group.append(el('label', undefined, channel === 'rotation' ? 'rot°' : channel.slice(0, 3)))

      for (const axis of AXES) {
        const input = el('input')
        input.type = 'number'
        input.step = channel === 'rotation' ? '5' : '0.05'
        input.title = `${channel} ${axis.toUpperCase()}`

        input.addEventListener('input', () => {
          const typed = Number(input.value)
          if (!Number.isFinite(typed)) return

          if (channel === 'scale' && tools.isProportional()) {
            const previous = object.scale[axis]
            // Applied as a ratio so the other two axes keep whatever relative
            // proportion they already had.
            if (previous > 0) object.scale.multiplyScalar(typed / previous)
            else object.scale.set(typed, typed, typed)
            return
          }

          // Rotation is shown in degrees because that is what a person reasons
          // about, but three stores radians.
          object[channel][axis] = channel === 'rotation' ? (typed * Math.PI) / 180 : typed
        })

        group.append(input)
        fields.push({ input, channel, axis })
      }

      nodes.push(group)
    }

    const lock = el('input')
    lock.type = 'checkbox'
    lock.id = 'lock-proportions'
    lock.checked = tools.isProportional()
    lock.addEventListener('change', () => tools.setProportional(lock.checked))
    lockBox = lock

    const lockLabel = el('label', undefined, 'lock proportions')
    lockLabel.htmlFor = lock.id
    lockLabel.style.cursor = 'pointer'

    const lockRow = el('div', 'row')
    lockRow.style.marginTop = '6px'
    lockRow.append(lock, lockLabel)
    nodes.push(lockRow)

    const ground = el('button', undefined, 'Sit on ground')
    ground.title = 'Drop it so its lowest point touches y = 0'
    ground.addEventListener('click', () => {
      // Recomputed from the world bounds, so it stays correct after a rotation
      // or a scale change.
      object.updateWorldMatrix(true, true)
      object.position.y -= new Box3().setFromObject(object).min.y
    })

    const reset = el('button', undefined, 'Reset size')
    reset.title = 'Back to the scale the model was exported at'
    reset.addEventListener('click', () => object.scale.set(1, 1, 1))

    const row = el('div', 'row')
    row.style.marginTop = '6px'
    row.append(ground, reset)
    nodes.push(row)

    selectedBody.replaceChildren(...nodes)
  }

  function updateFields(): void {
    const object = getSelected()?.object
    if (!object) return

    for (const { input, channel, axis } of fields) {
      // Never overwrite a field mid-edit: typing "1.2" briefly passes through
      // "1." and reformatting that would fight the user's cursor.
      if (document.activeElement === input) continue
      const raw = object[channel][axis]
      input.value = fmt(channel === 'rotation' ? (raw * 180) / Math.PI : raw)
    }

    if (sizeInput && document.activeElement !== sizeInput) {
      sizeInput.value = fmt(currentSize(object))
    }
  }

  // ── Camera readout ───────────────────────────────────────────────────
  function updateCamera(): void {
    const { camera, controls } = viewport
    cameraReadout.textContent = [
      `pos    ${fmt(camera.position.x)}  ${fmt(camera.position.y)}  ${fmt(camera.position.z)}`,
      `target ${fmt(controls.target.x)}  ${fmt(controls.target.y)}  ${fmt(controls.target.z)}`,
      `fov    ${fmt(camera.fov)}`,
    ].join('\n')
  }

  // ── Output ───────────────────────────────────────────────────────────
  must<HTMLButtonElement>('copy-snippet').addEventListener('click', async () => {
    const snippet = buildSnippet(viewport, background)
    try {
      await copyToClipboard(snippet)
      copyStatus.textContent = `copied ${getModels().length} model(s) + camera`
      copyStatus.classList.remove('warn')
    } catch {
      copyStatus.textContent = 'clipboard blocked — snippet logged to the console'
      copyStatus.classList.add('warn')
      console.log(snippet)
    }
  })

  must<HTMLButtonElement>('clear-scene').addEventListener('click', () => {
    if (getModels().length > 0) hooks.clearScene()
  })

  subscribe(() => {
    renderModelList()
    renderSelected()
    updateFields()
  })

  renderModelList()
  renderSelected()

  viewport.onFrame(() => {
    updateCamera()
    updateFields()
  })

  return { refreshLibrary }
}
