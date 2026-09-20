import { Box3 } from 'three'
import type { Viewport } from './scene.ts'
import {
  getModels,
  getSelected,
  select,
  subscribe,
  touch,
  type SceneModel,
} from './scene-store.ts'
import { buildSnippet, copyToClipboard } from './snippet.ts'

export type PanelHooks = {
  /** Loads a model from public/models by file name. */
  addFromLibrary(fileName: string): void
  addTestCube(): void
  removeModel(id: string): void
  clearScene(): void
  /** Re-reads the manifest; resolves with the file names found. */
  listLibrary(): Promise<string[]>
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

export function createPanel(viewport: Viewport, hooks: PanelHooks): Panel {
  const panel = must('panel')
  const cameraReadout = must('camera-readout')
  const libraryList = must('library-list')
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
  async function refreshLibrary(): Promise<void> {
    libraryList.replaceChildren(el('div', 'muted', 'reading public/models…'))
    const files = await hooks.listLibrary()

    if (files.length === 0) {
      libraryList.replaceChildren(
        el('div', 'muted', 'public/models is empty — drop a .glb on the canvas'),
      )
      return
    }

    libraryList.replaceChildren(
      ...files.map((file) => {
        const row = el('div', 'item')
        row.append(el('span', 'item-name', file))
        row.append(el('span', 'item-id', 'add'))
        row.addEventListener('click', () => hooks.addFromLibrary(file))
        return row
      }),
    )
  }

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

  function renderSelected(): void {
    const selected = getSelected()
    fields = []

    if (!selected?.object) {
      selectedBody.replaceChildren(el('div', 'muted', 'click a model in the scene'))
      return
    }

    const object = selected.object
    const nodes: HTMLElement[] = [el('div', 'muted', `${selected.name}  ·  ${selected.id}`)]

    if (selected.unitWarning) {
      nodes.push(el('div', 'warn', `⚠ ${selected.unitWarning}`))
    }

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
          // Rotation is shown in degrees because that is what a person reasons
          // about, but three stores radians.
          object[channel][axis] = channel === 'rotation' ? (typed * Math.PI) / 180 : typed
        })

        group.append(input)
        fields.push({ input, channel, axis })
      }

      nodes.push(group)
    }

    const ground = el('button', undefined, 'Sit on ground')
    ground.title = 'Drop it so its lowest point touches y = 0'
    ground.addEventListener('click', () => {
      // Recomputed from the world bounds, so it stays correct after a rotation
      // or a scale change.
      object.updateWorldMatrix(true, true)
      object.position.y -= new Box3().setFromObject(object).min.y
    })

    const row = el('div', 'row')
    row.style.marginTop = '6px'
    row.append(ground)
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
    const snippet = buildSnippet(viewport)
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
