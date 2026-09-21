# constructor 3d

A browser playground for composing 3D scenes: add GLB models, move, rotate and resize
them until the arrangement works, then copy the exact coordinates out of the side panel
and paste them into the site that will use them.

![the playground](docs/screenshot.png)

## What it does

- **Add models** from `public/models/` or by dragging a `.glb` onto the canvas.
- **Move them** with a gizmo (`W` translate, `E` rotate, `R` scale) or by typing exact
  numbers into the panel. The two can never disagree — both read the same object.
- **Size them** in metres. The panel shows how big a model actually is, not just its
  scale factor, and keeps the proportions locked unless you say otherwise.
- **Set a backdrop**: any photo is wrapped around the scene as a panorama, with controls
  for spin, horizon, blur and brightness, and an option to light the models with it.
- **Copy coordinates** as a ready-to-paste TypeScript block: camera, backdrop and every
  model's transform.
- The scene is saved to `localStorage`, so a refresh does not throw away an afternoon of
  arranging.

## Running it

```
npm install
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

Vite + vanilla TypeScript + three.js. No framework.

## Assets

Drop `.glb` / `.gltf` files into `public/models/` and backdrop images into
`public/backgrounds/`; they appear in the panel without a restart. Both folders are
git-ignored, since the files are large binaries — a fresh clone starts empty.

## Publishing

Pushing to `main` builds the site and deploys it to GitHub Pages
(`.github/workflows/deploy.yml`). Set **Settings → Pages → Source** to *GitHub Actions*
once and it runs on its own.
