# constructor 3d

A **3D playground**: a scene where you add GLB models, drag them around until the
composition works, and then read the exact coordinates back out of the side panel so they
can be hardcoded into the site that will use them. The playground is the authoring tool;
the numbers it produces are the point of it.

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
| `background.ts` | The backdrop image: loading, spin, blur, brightness, image-based lighting. |
| `transform.ts` | TransformControls gizmo, click-to-select raycasting, hotkeys. |
| `panel.ts` | The side panel: camera readout, library, model list, numeric fields. |
| `snippet.ts` | Scene state → the copyable TypeScript block. |
| `persist.ts` | localStorage autosave and restore. |
| `uploads.ts` | Talking to the shared Blob library: listing it, and uploading to it. |

Plus `api/`, two Vercel serverless functions: `upload.ts` (checks the password, mints a
client token) and `assets.ts` (lists the store).

### The one rule worth knowing

**A model's transform lives on its `Object3D` and nowhere else.** The store never mirrors
position, rotation or scale, and the panel reads them off the object every frame. This is
why the gizmo and the number fields can't drift apart. If you are ever tempted to cache a
transform in the store, don't — the only exception is `savedTransform`, which exists
purely for rows whose object is gone.

## Assets

Drop `.glb` / `.gltf` models into `public/models/` and backdrop images
(`.jpg`, `.png`, `.webp`, `.avif`, `.hdr`) into `public/backgrounds/`. A small Vite plugin
in `vite.config.ts` serves both directory listings at `/asset-manifest.json`, in dev from
disk on every request and in a build as an emitted file — so a file copied in mid-session
appears in the panel after hitting ↻, with no restart and no manifest to maintain.

Asset files are **git-ignored**: they are large binaries and usually still in flux.

You can also drag a file straight onto the canvas. Those load from a blob URL, which dies
with the page, so after a reload they come back as a greyed "re-drop X" row that still
holds its transform.

Models load at **native scale**. Auto-fitting each one (as situ-web does for its single
model) would destroy the relative sizes between models, which is most of what we are
trying to judge here. A model whose largest dimension is above 50 or below 0.05 gets a
unit warning in the panel instead.

## Sizing models

Models arrive at native scale, so the panel shows **size** — the largest of the model's
exported width/height/depth multiplied by its scale, in metres — above the raw scale
factors. A scale of `1.4` only means something if you remember what the model was
exported at; `1.5 m` does not need that. Typing in the field rescales the model so its
largest dimension measures what you typed.

`measureLocal` in `loader.ts` neutralises the root transform before measuring, because
`Box3.setFromObject` works in world space and would otherwise report a model as growing
when it is merely rotated.

**Lock proportions** (on by default, `L`) keeps the three scale axes in step: a gizmo
scale drag on any handle applies the ratio of the axis that moved furthest to all three,
and typing in one scale field does the same. Non-uniform scaling is still available with
the lock off, but stretching a model on one axis is nearly always a mistake.

Scaling happens about the object's origin, so a resized model usually needs **Sit on
ground** afterwards.

## The shared library

Three routes get a file into the scene, and they are deliberately different things:

- **Dropped** on the canvas — a blob URL in one tab. Dies on reload, which is why those
  rows come back as "re-drop X".
- **Bundled** in `public/` — served from the site's own origin, listed by the Vite plugin.
- **Uploaded** — lives in Vercel Blob, listed by `/api/assets`, shown with a *shared* tag
  and visible to everyone.

A bundled file wins over an uploaded one of the same name: same origin, and in development
it is the copy actually being edited.

Uploads go **from the browser straight to Blob storage**. `api/upload.ts` only validates
and mints a client token, because a serverless request body tops out at 4.5 MB and models
go well past that.

The password is checked by an explicit `{ type: 'password-check' }` request before any
bytes move. This looks redundant — `onBeforeGenerateToken` rejects a bad password anyway —
but `@vercel/blob`'s client discards the body of a failed token request, so every refusal
would otherwise reach the user as "failed to retrieve the client token". The token path
still re-checks: the browser is not the only thing that can post there. Don't collapse
the two.

Uploads are refused outright when `UPLOAD_PASSWORD` is unset, so a deployment is never
accidentally an open write endpoint.

## The background

The backdrop is an **equirectangular panorama on `scene.background`**. That is three's own
inside-of-a-sphere rendering: the renderer draws the image on a sphere that follows the
camera, so it fills the viewport at any aspect ratio and can never be clipped or walked
through — which is exactly what a real inverted sphere mesh of some fixed radius would do
the moment a model or the camera went past it. There is deliberately **no sphere mesh** in
the scene; don't add one.

An ordinary (non-360) photo is refitted first, in `fitToEquirect`. Handing a 4:3 photo
straight to three squashes it into the 2:1 band and drags its horizon far above eye level
— a beach shot then shows nothing but sand until you orbit upwards. Instead the photo
keeps its aspect ratio across the full 360°, and the **horizon** slider moves it
vertically so its real skyline can be put on the viewer's eye line. The poles are filled
by stretching the photo's own top and bottom rows, which reads as sky and ground rather
than the hard seam you get when the image runs out. A true 2:1 panorama skips all of this
and the slider is hidden.

The fitted canvas is sized from the source and never upscales it: the same texture feeds
the cubemap conversion behind image-based lighting, and that gets expensive fast.

`DEFAULT_BACKGROUND` in `main.ts` is what a fresh session opens on, with the horizon
offset that suits that particular photo.

The panel also exposes spin, blur, brightness, and a "light the models with it" toggle. That
toggle also assigns the texture to `scene.environment`; the renderer converts the
equirectangular texture to the cubemap that image-based lighting needs, so one texture
serves both roles.

Only the **Y axis** of the rotation is exposed. Tilting a panorama on X or Z throws the
horizon off level, which is never what we want here — the snippet still emits a full
`[0, y, 0]` triple so the real site can consume it directly.

## Hotkeys

`W` / `E` / `R` translate · rotate · scale · `X` world/local · `L` lock proportions ·
`G` grid · `Esc` deselect · `Del` remove · `H` hide the panel.

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
