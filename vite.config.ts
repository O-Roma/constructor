import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const MODELS_DIR = fileURLToPath(new URL('./public/models', import.meta.url))
const MODEL_EXT = /\.(glb|gltf)$/i

// Where the browser asks for the list of available models. The same URL works in
// dev (middleware below) and in a build (emitted as a real file), so the client
// only ever knows about one path.
const MANIFEST_URL = '/models-manifest.json'

function listModels(): string[] {
  try {
    return readdirSync(MODELS_DIR)
      .filter((name) => MODEL_EXT.test(name))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    // public/models may not exist yet on a fresh clone. An empty library is a
    // perfectly usable playground — drag & drop still works.
    return []
  }
}

// Reports what is actually sitting in public/models. The alternative, a manifest
// file we maintain by hand, goes stale the instant someone copies a .glb in —
// which is the entire workflow this playground exists to support.
function modelsManifest(): Plugin {
  return {
    name: 'playanegra-models-manifest',

    configureServer(server) {
      server.middlewares.use(MANIFEST_URL, (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        // The folder is read per request, so a file copied in mid-session shows
        // up on the next refresh of the library list without restarting vite.
        res.end(JSON.stringify(listModels()))
      })
    },

    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_URL.slice(1),
        source: JSON.stringify(listModels()),
      })
    },
  }
}

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  plugins: [modelsManifest()],
})
