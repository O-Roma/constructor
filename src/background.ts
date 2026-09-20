import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import type { Viewport } from './scene.ts'

export type BackgroundOrigin = 'library' | 'dropped'

export type BackgroundSettings = {
  /** Spin around the vertical axis, in radians — which part of the panorama faces the camera. */
  rotationY: number
  /** 0 = sharp, 1 = fully blurred. Useful for pushing a backdrop behind the garments. */
  blur: number
  /** Brightness multiplier on the backdrop only. */
  intensity: number
  /** Also light the models with the image, not just draw it behind them. */
  lighting: boolean
}

export type BackgroundImage = {
  name: string
  /** Path the snippet emits, e.g. '/backgrounds/beach.jpg'. */
  src: string
  origin: BackgroundOrigin
  /** False for a row restored from localStorage whose blob URL died with the page. */
  loaded: boolean
}

export type BackgroundController = {
  getImage(): BackgroundImage | null
  getSettings(): BackgroundSettings
  /** `url` is what we fetch; `src` is what the snippet emits. They differ for a dropped file. */
  set(image: Omit<BackgroundImage, 'loaded'>, url: string): Promise<void>
  /** Restores settings for an image we cannot reload, so the numbers are not lost. */
  setMissing(image: Omit<BackgroundImage, 'loaded'>, settings: BackgroundSettings): void
  update(changes: Partial<BackgroundSettings>): void
  clear(): void
  subscribe(listener: () => void): () => void
}

export const DEFAULT_SETTINGS: BackgroundSettings = {
  rotationY: 0,
  blur: 0,
  intensity: 1,
  lighting: false,
}

const HDR_EXT = /\.hdr$/i

export function createBackground(viewport: Viewport): BackgroundController {
  const { scene } = viewport

  let image: BackgroundImage | null = null
  let settings: BackgroundSettings = { ...DEFAULT_SETTINGS }
  let texture: THREE.Texture | null = null
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
    scene.background = texture
    scene.backgroundBlurriness = settings.blur
    scene.backgroundIntensity = settings.intensity
    scene.backgroundRotation.set(0, settings.rotationY, 0)

    // The renderer converts an equirectangular texture into the cubemap that
    // image-based lighting needs, so the same texture serves both roles.
    scene.environment = settings.lighting ? texture : null
    scene.environmentIntensity = settings.intensity
    scene.environmentRotation.set(0, settings.rotationY, 0)

    // Without a backdrop the scene falls back to the flat studio grey it starts
    // out as, rather than going black.
    if (!texture) scene.background = new THREE.Color(0x0c0c0d)
  }

  function replaceTexture(next: THREE.Texture | null): void {
    texture?.dispose()
    texture = next
  }

  return {
    getImage: () => image,
    getSettings: () => ({ ...settings }),

    async set(next, url) {
      const token = ++loadToken
      const isHdr = HDR_EXT.test(next.name)

      const loaded = isHdr
        ? await new RGBELoader().loadAsync(url)
        : await new THREE.TextureLoader().loadAsync(url)

      // A second image was picked while this one was decoding.
      if (token !== loadToken) {
        loaded.dispose()
        return
      }

      loaded.mapping = THREE.EquirectangularReflectionMapping
      // RGBE data is already linear float; tagging it sRGB would double-correct it.
      if (!isHdr) loaded.colorSpace = THREE.SRGBColorSpace

      replaceTexture(loaded)
      image = { ...next, loaded: true }
      apply()
      emit()
    },

    setMissing(next, restored) {
      loadToken += 1
      replaceTexture(null)
      settings = { ...restored }
      image = { ...next, loaded: false }
      apply()
      emit()
    },

    update(changes) {
      settings = { ...settings, ...changes }
      apply()
      emit()
    },

    clear() {
      loadToken += 1
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
