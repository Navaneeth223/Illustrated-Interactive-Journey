# Asset Pipeline

## Overview

The Illustrated Interactive Journey uses a two-resolution asset strategy for the
parallax layer sprites.  Each segment exposes three layers — **bg** (background),
**mg** (midground), and **fg** (foreground) — at two resolutions:

| File                      | Purpose                                      |
|---------------------------|----------------------------------------------|
| `assets/seg01/bg.webp`    | Full-resolution (1×), used in Default Quality mode |
| `assets/seg01/bg@0.5x.webp` | Half-resolution (0.5×), used in Eco Quality mode  |

The `PixiRenderer.setQualityMode("eco")` call swaps every tracked sprite's
texture to the `@0.5x` URL by inserting `@0.5x` immediately before the file
extension (e.g. `bg.webp` → `bg@0.5x.webp`).  Switching back to `"default"`
strips the suffix and reloads the canonical assets.

---

## Naming Convention

```
public/assets/<segNN>/<layer>.webp          ← full-res  (1× logical pixels)
public/assets/<segNN>/<layer>@0.5x.webp    ← half-res  (0.5× logical pixels)
```

Where:
- `<segNN>` is `seg01` … `seg08`
- `<layer>` is one of `bg`, `mg`, `fg`

---

## Development Stubs

The files currently committed under `public/assets/` are **1×1 pixel
placeholder WebP** files.  They are syntactically valid so Vite's dev server
and the PixiJS asset loader resolve the URLs without throwing; they carry no
visual content.

Replace each stub with the real artwork before shipping:

```
public/assets/
  seg01/bg.webp  bg@0.5x.webp  mg.webp  mg@0.5x.webp  fg.webp  fg@0.5x.webp
  seg02/ …
  …
  seg08/ …
```

---

## Production Build — Generating `@0.5x` Assets

The half-resolution assets must be generated from the full-resolution masters
at build time.  Two options are documented below.

### Option A — npm script with `sharp` (recommended)

Install `sharp` as a dev dependency:

```bash
npm install --save-dev sharp
```

Create `scripts/generate-eco-textures.mjs`:

```js
import sharp from "sharp";
import { globSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = new URL("../public/assets", import.meta.url);

async function processDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await processDir(fullPath);
    } else if (
      entry.isFile() &&
      extname(entry.name) === ".webp" &&
      !entry.name.includes("@0.5x")
    ) {
      const halfPath = join(
        dir,
        basename(entry.name, ".webp") + "@0.5x.webp"
      );
      await sharp(fullPath)
        .resize({ width: null, height: null, factor: 0.5 })
        .toFile(halfPath);
      console.log(`Generated ${halfPath}`);
    }
  }
}

processDir(fileURLToPath(assetsDir)).catch(console.error);
```

Add to `package.json`:

```json
{
  "scripts": {
    "generate:eco": "node scripts/generate-eco-textures.mjs",
    "build": "npm run generate:eco && tsc && vite build"
  }
}
```

### Option B — ImageMagick one-liner

If `sharp` is unavailable, use ImageMagick's `mogrify`:

```bash
# From the project root, for each segment directory:
for seg in public/assets/seg*/; do
  for full in "$seg"bg.webp "$seg"mg.webp "$seg"fg.webp; do
    name="${full%.webp}"
    convert "$full" -resize 50% "${name}@0.5x.webp"
  done
done
```

### Option C — Vite plugin (advanced)

For an integrated, watch-mode solution the `vite-imagetools` or a custom Vite
plugin can perform the resize at dev-startup and keep the half-res files in
sync automatically.  See the [vite-imagetools docs](https://github.com/JonasKruckenberg/imagetools)
for the `w` transform parameter.

---

## Manifest Integration

The journey manifest (`public/journey.manifest.json`) references full-resolution
URLs only.  The `PixiRenderer` derives the `@0.5x` variant at runtime — no
manifest change is required when switching quality modes.

Example manifest entry:

```json
{
  "id": "seg-01-departure",
  "index": 0,
  "role": "departure",
  "widthPx": 3840,
  "layers": {
    "background": "assets/seg01/bg.webp",
    "midground":  "assets/seg01/mg.webp",
    "foreground": "assets/seg01/fg.webp"
  },
  "audioTrack": "assets/audio/seg01.mp3",
  "edgeMatchOffsetLeft": 0,
  "edgeMatchOffsetRight": 0
}
```

---

## Quality Mode Summary

| Mode    | `renderer.resolution` | Textures loaded      | Grain sprite |
|---------|-----------------------|----------------------|--------------|
| Default | `devicePixelRatio` (≤ 2) | `<layer>.webp`      | visible      |
| Eco     | `1`                   | `<layer>@0.5x.webp` | hidden       |

See `src/modules/PixiRenderer.ts → setQualityMode()` for the implementation.
