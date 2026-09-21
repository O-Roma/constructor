import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import type { Viewport } from './scene.ts'

export type BackgroundOrigin = 'library' | 'dropped'

export type BackgroundSettings = {
  /** Spin around the vertical axis, in radians — which part of the panorama faces the camera. */
  rotationY: number
  /**
   * Slides an ordinary photo up or down the sphere, as a fraction of the
   * sphere's height. Use it to put the photo's horizon at eye level. Ignored
   * for a true 2:1 panorama, which already knows where its own horizon is.
   */
  horizon: number
  /** 0 = sharp, 1 = fully blurred. Useful for pushing a backdrop behind the models. */
  blur: number
  /** Brightness multiplier on the backdrop only. */
  intensity: number
  /** Also light the models with the image, not just draw it behind them. */
  lighting: boolean
}

export type BackgroundImage = {
  name: string
  /** Path the snippet emits, e.g. '/backgrounds/playa.jpeg'. */
  src: string
  origin: BackgroundOrigin
  /** False for a row restored from localStorage whose blob URL died with the page. */
  loaded: boolean
  /** True when the source is already 2:1 and needs no refitting — the horizon slider is then pointless. */
  panoramic: boolean
}

export type BackgroundController = {
  getImage(): BackgroundImage | null
  getSettings(): BackgroundSettings
  /** `url` is what we fetch; `src` is what the snippet emits. They differ for a dropped file. */
  set(image: Omit<BackgroundImage, 'loaded' | 'panoramic'>, url: string): Promise<void>
  /** Restores settings for an image we cannot reload, so the numbers are not lost. */
  setMissing(image: Omit<BackgroundImage, 'loaded' | 'panoramic'>, settings: BackgroundSettings): void
  update(changes: Partial<BackgroundSettings>): void
  clear(): void
  subscribe(listener: () => void): () => void
}

export const DEFAULT_SETTINGS: BackgroundSettings = {
  rotationY: 0,
  horizon: 0,
  blur: 0,
  intensity: 1,
  lighting: false,
}

const HDR_EXT = /\.hdr$/i

/** An equirectangular map is 2:1 — 360° around by 180° top to bottom. */
const EQUIRECT_ASPECT = 2
const MIN_CANVAS_WIDTH = 1024
const MAX_CANVAS_WIDTH = 4096

/**
 * The canvas is sized from the photo rather than fixed, for two reasons:
 * upscaling invents detail the source never had, and the texture also feeds the
 * cubemap conversion behind image-based lighting, which gets expensive fast.
 */
function canvasWidthFor(sourceWidth: number): number {
  // Floor, not round: rounding up would upscale the photo, which is the one
  // thing this is meant to avoid.
  const power = 2 ** Math.floor(Math.log2(sourceWidth))
  return Math.min(Math.max(power, MIN_CANVAS_WIDTH), MAX_CANVAS_WIDTH)
}

function isPanoramic(width: number, height: number): boolean {
  return Math.abs(width / height - EQUIRECT_ASPECT) < 0.05
}

/**
 * Redraws an ordinary photo onto the 2:1 canvas an equirectangular map needs.
 *
 * Handing a 4:3 photo straight to three squashes it into the 2:1 band, which
 * drags the photo's horizon far above eye level — a beach shot ends up showing
 * nothing but sand until you orbit upwards. Here the photo keeps its aspect
 * ratio across the full 360° instead, and `horizon` slides it vertically so its
 * real horizon can be put on the viewer's eye line.
 *
 * Whatever is left uncovered at the poles is filled by stretching the photo's
 * own top and bottom rows, which reads as sky and ground rather than the hard
 * seam you get when the image simply runs out.
 */
function fitToEquirect(image: CanvasImageSource, width: number, height: number, horizon: number): HTMLCanvasElement {
  const canvasWidth = canvasWidthFor(width)

  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasWidth / EQUIRECT_ASPECT

  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')

  const drawnHeight = (canvasWidth * height) / width
  // Centred in the band, then shifted by up to half the sphere either way.
  const top = (canvas.height - drawnHeight) / 2 + horizon * canvas.height

  context.drawImage(image, 0, top, canvasWidth, drawnHeight)

  if (top > 0) {
    context.drawImage(image, 0, 0, width, 1, 0, 0, canvasWidth, Math.ceil(top))
  }

  const bottom = top + drawnHeight
  if (bottom < canvas.height) {
    const gap = Math.ceil(canvas.height - bottom)
    context.drawImage(image, 0, height - 1, width, 1, 0, Math.floor(bottom), canvasWidth, gap)
  }

  return canvas
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = url
  await image.decode()
  return image
}

export function createBackground(viewport: Viewport): BackgroundController {
  const { scene } = viewport

  let image: BackgroundImage | null = null
  let settings: BackgroundSettings = { ...DEFAULT_SETTINGS }
  let texture: THREE.Texture | null = null
  /** Kept so the horizon slider can redraw without fetching the file again. */
  let source: HTMLImageElement | null = null
  /** Bumped on every set() so a slow load that lost the race cannot overwrite a newer one. */
  let loadToken = 0

  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  /**
   * Pushes the current texture and settings at the scene.
   *
   * `scene.background` with an equirectangular texture is three's own
   * inside-of-a-sphere rendering: the renderer draws it on a sphere that follows
   * the camera, so it always fills the viewport at any aspect ratio and can
   * never be clipped or walked through the way a real mesh sphere of some fixed
   * radius could be.
   */
  function apply(): void {
    // Without a backdrop the scene falls back to the studio grey it starts out
    // as, rather than going black.
    scene.background = texture ?? new THREE.Color(0x0c0c0d)
    scene.backgroundBlurriness = settings.blur
    scene.backgroundIntensity = settings.intensity
    scene.backgroundRotation.set(0, settings.rotationY, 0)

    // The renderer converts an equirectangular texture into the cubemap that
    // image-based lighting needs, so the same texture serves both roles.
    scene.environment = settings.lighting ? texture : null
    scene.environmentIntensity = settings.intensity
    scene.environmentRotation.set(0, settings.rotationY, 0)
  }

  function replaceTexture(next: THREE.Texture | null): void {
    texture?.dispose()
    texture = next
    if (next) next.mapping = THREE.EquirectangularReflectionMapping
  }

  /** Redraws the fitted canvas after the horizon moves. */
  function rebake(): void {
    if (!source) return
    const canvas = fitToEquirect(source, source.naturalWidth, source.naturalHeight, settings.horizon)
    const next = new THREE.CanvasTexture(canvas)
    next.colorSpace = THREE.SRGBColorSpace
    replaceTexture(next)
  }

  return {
    getImage: () => image,
    getSettings: () => ({ ...settings }),

    async set(next, url) {
      const token = ++loadToken

      if (HDR_EXT.test(next.name)) {
        // An HDR is authored as a full panorama, so it goes to the sphere as-is.
        const loaded = await new RGBELoader().loadAsync(url)
        if (token !== loadToken) {
          loaded.dispose()
          return
        }
        source = null
        replaceTexture(loaded)
        image = { ...next, loaded: true, panoramic: true }
      } else {
        const loadedImage = await loadImage(url)
        if (token !== loadToken) return

        const { naturalWidth: width, naturalHeight: height } = loadedImage
        const panoramic = isPanoramic(width, height)

        if (panoramic) {
          // Already the right shape — skip the canvas and keep full resolution.
          source = null
          const loaded = new THREE.Texture(loadedImage)
          loaded.colorSpace = THREE.SRGBColorSpace
          loaded.needsUpdate = true
          replaceTexture(loaded)
        } else {
          source = loadedImage
          rebake()
        }

        image = { ...next, loaded: true, panoramic }
      }

      apply()
      emit()
    },

    setMissing(next, restored) {
      loadToken += 1
      source = null
      replaceTexture(null)
      settings = { ...restored }
      image = { ...next, loaded: false, panoramic: true }
      apply()
      emit()
    },

    update(changes) {
      const horizonMoved = changes.horizon !== undefined && changes.horizon !== settings.horizon
      settings = { ...settings, ...changes }
      // Only the horizon needs the canvas redrawn; the rest are scene properties.
      if (horizonMoved) rebake()
      apply()
      emit()
    },

    clear() {
      loadToken += 1
      source = null
      replaceTexture(null)
      image = null
      settings = { ...DEFAULT_SETTINGS }
      apply()
      emit()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
