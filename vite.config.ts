import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url))

const MODEL_EXT = /\.(glb|gltf)$/i
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|hdr)$/i

// Where the browser asks for the list of available assets. The same URL works in
// dev (middleware below) and in a build (emitted as a real file), so the client
// only ever knows about one path.
const MANIFEST_URL = '/asset-manifest.json'

function listDir(folder: string, extensions: RegExp): string[] {
  try {
    return readdirSync(`${PUBLIC_DIR}/${folder}`)
      .filter((name) => extensions.test(name))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    // The folder may not exist yet on a fresh clone. An empty library is a
    // perfectly usable playground — drag & drop still works.
    return []
  }
}

function manifest(): string {
  return JSON.stringify({
    models: listDir('models', MODEL_EXT),
    backgrounds: listDir('backgrounds', IMAGE_EXT),
  })
}

// Reports what is actually sitting in public/models and public/backgrounds. The
// alternative, a manifest file we maintain by hand, goes stale the instant
// someone copies a file in — which is the entire workflow this playground
// exists to support.
function assetManifest(): Plugin {
  return {
    name: 'playanegra-asset-manifest',

    configureServer(server) {
      server.middlewares.use(MANIFEST_URL, (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        // Read per request, so a file copied in mid-session shows up on the
        // next refresh of the list without restarting vite.
        res.end(manifest())
      })
    },

    generateBundle() {
      this.emitFile({ type: 'asset', fileName: MANIFEST_URL.slice(1), source: manifest() })
    },
  }
}

export default defineConfig({
  assetsInclude: ['**/*.glb', '**/*.hdr'],
  plugins: [assetManifest()],
})
