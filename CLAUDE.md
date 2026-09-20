# playanegra

Website for the **playanegra** clothing brand.

Right now it is only a **3D playground**: a scene where you add GLB models, drag them
around until the composition works, and then read the exact coordinates back out of the
side panel so they can be hardcoded into the real site later. The playground is the
authoring tool; the numbers it produces are the point of it.

## Running it

```
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc && vite build — a dead variable fails the build
npm run preview
```

## Stack

Vite + vanilla TypeScript + three.js. **No React, no framework.** This matches
`../situ-web`, the other three.js site in this account.

- No path aliases — imports are relative (`./scene.ts`).
- `tsconfig.json` is strict, with `noUnusedLocals` and `noUnusedParameters` on, and
  `build` runs `tsc` first, so dead code breaks the build rather than piling up.
- `verbatimModuleSyntax` is on: type-only imports must say `import type`.
- All CSS lives in a `<style>` block in `index.html`, `#id`-based selectors. No Tailwind.
- File names are kebab-case.
- Comments explain *why*, not *what*. Match the existing density — most non-obvious
  constants carry a sentence about the problem they solve.

## Source map

Everything in `src/` is flat, one concern per file:

| File | Holds |
| --- | --- |
| `main.ts` | Bootstrap. Adding and removing models, drag & drop, restoring the last session. |
| `scene.ts` | Renderer, camera, lights, grid, OrbitControls, render loop. |
| `scene-store.ts` | The list of placed models and which one is selected. |
| `loader.ts` | GLTFLoader wrapper, ground placement, unit sanity check, disposal. |
| `transform.ts` | TransformControls gizmo, click-to-select raycasting, hotkeys. |
| `panel.ts` | The side panel: camera readout, library, model list, numeric fields. |
| `snippet.ts` | Scene state → the copyable TypeScript block. |
| `persist.ts` | localStorage autosave and restore. |

### The one rule worth knowing

**A model's transform lives on its `Object3D` and nowhere else.** The store never mirrors
position, rotation or scale, and the panel reads them off the object every frame. This is
why the gizmo and the number fields can't drift apart. If you are ever tempted to cache a
transform in the store, don't — the only exception is `savedTransform`, which exists
purely for rows whose object is gone.

## Models

Drop `.glb` / `.gltf` files into `public/models/`. A small Vite plugin in
`vite.config.ts` serves that directory listing at `/models-manifest.json`, in dev from
disk on every request and in a build as an emitted file — so a model copied in mid-session
appears in the library after hitting ↻, with no restart and no manifest to maintain.

Model files are **git-ignored**: they are large binaries and usually still in flux.

You can also drag a file straight onto the canvas. Those load from a blob URL, which dies
with the page, so after a reload they come back as a greyed "re-drop X" row that still
holds its transform.

Models load at **native scale**. Auto-fitting each one (as situ-web does for its single
model) would destroy the relative sizes between garments, which is most of what we are
trying to judge here. A model whose largest dimension is above 50 or below 0.05 gets a
unit warning in the panel instead.

## Hotkeys

`W` / `E` / `R` translate · rotate · scale · `X` world/local · `G` grid · `Esc` deselect ·
`Del` remove · `H` hide the panel.

## Conventions

- **All code is English** — names, comments, commit messages. Only user-facing copy would
  be Spanish.
- **Commits:** brief, single line, imperative, describing the user-visible effect, usually
  with a *why* clause. No conventional-commit prefixes. Matching `../situ-web`:
  `Serve a lighter model on phones so iPhones stop crashing`.
- **Never add a `Co-Authored-By: Claude` trailer** or any other Claude attribution.
- Commit straight to `main`. No feature branches on this project.

## Next

The playground is feature one. The real site is not designed yet — the coordinates copied
out of here are what it will be built from.
