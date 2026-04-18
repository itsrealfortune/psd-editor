# psd-template

> TypeScript library to use Photoshop `.psd` files as templates — edit text layers and smart object images, then export a pixel-perfect PNG rendered by ImageMagick (blending modes fully preserved).

---

## Architecture

```
PSD file
  │
  ├─ ag-psd          → parse layers, patch text content & font styles,
  │                     replace smart-object canvas + linked-file bytes
  │
  ├─ writePsdBuffer  → serialize the mutated PSD to a temp file
  │
  ├─ ImageMagick     → flatten all layers (respects blending modes, fx…)
  │   -flatten          into a composite PNG
  │
  └─ sharp           → optional resize / scale → final output PNG
```

**Why ImageMagick for the final render?**  
No pure-JS library can faithfully replicate every Photoshop blending mode. ImageMagick handles them natively — Multiply, Screen, Overlay, Color Dodge, Luminosity, etc. all render correctly.

---

## Prerequisites

### Node packages

```bash
npm install ag-psd canvas sharp
```

> `canvas` requires native bindings. On a fresh machine:
> - **macOS**: `brew install pkg-config cairo pango libpng jpeg giflib librsvg`
> - **Ubuntu/Debian**: `apt install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`

### ImageMagick

```bash
# macOS
brew install imagemagick

# Ubuntu / Debian
sudo apt install imagemagick

# Windows
winget install ImageMagick.ImageMagick
```

The library auto-detects `magick` (IM7) and `convert` (IM6).

---

## Quick start

```ts
import { PsdTemplate } from "./src/index";

const tpl = await PsdTemplate.load("./template.psd");

// Step 1 — discover your layer names
tpl.printLayers();

// Step 2 — render
await tpl.render(
  {
    texts: [
      { layerName: "Title",    text: "Summer Collection" },
      { layerName: "Subtitle", text: "Up to 50% off", fontSize: 24, color: [255, 220, 0] },
    ],
    images: [
      { layerName: "Hero Photo", imagePath: "./hero.jpg",  fit: "cover"   },
      { layerName: "Logo",       imagePath: "./logo.png",  fit: "contain" },
    ],
  },
  { outputPath: "./output.png" }
);
```

---

## API

### `PsdTemplate.load(psdPath: string): Promise<PsdTemplate>`

Reads and parses a PSD file. Call this once per template file.

### `tpl.printLayers(): void`

Prints the full layer tree to stdout. Use this during development to find the exact names of your layers.

```
[group]       Background Group
  [image]     Background Texture
[text]        Title           → "Original title"
[text]        Subtitle        → "Original subtitle"
[smartObject] Hero Photo      [linked: hero.psb]
[smartObject] Logo            [linked: logo.psb]
```

### `tpl.inspectLayers(): LayerInfo[]`

Returns the layer tree as a structured array — useful for building UIs or validation.

### `tpl.render(replacements, options): Promise<void>`

Applies all replacements and exports a PNG. Safe to call multiple times (each call re-reads the original PSD, so mutations don't accumulate).

#### `replacements.texts` — `TextReplacement[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `layerName` | `string` | ✅ | Exact layer name in the PSD |
| `text` | `string` | ✅ | New text content |
| `fontSize` | `number` | — | Override font size in points |
| `color` | `[R, G, B]` | — | Override fill color (0–255 each) |

#### `replacements.images` — `ImageReplacement[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `layerName` | `string` | ✅ | Exact layer name (regular image or smart object) |
| `imagePath` | `string` | ✅ | Path to source image (PNG, JPEG, WEBP) |
| `fit` | `"cover"` \| `"contain"` \| `"stretch"` | — | Resize mode (default: `"cover"`) |

#### `options` — `ExportOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `outputPath` | `string` | ✅ | Path to write the output PNG |
| `compressionLevel` | `0–9` | `6` | PNG compression |
| `scale` | `number` | `1` | Scale factor (e.g. `0.5` for half size) |

---

## Smart objects vs. regular image layers

Both are handled transparently via `layerName`.

- **Regular image layer**: the layer's canvas bitmap is replaced.
- **Smart object**: the canvas bitmap *and* the embedded linked-file bytes are both replaced, ensuring ImageMagick uses the new image when it renders.

If your smart object has a **transform** applied in Photoshop (rotation, perspective warp, etc.), ImageMagick will re-apply it automatically because it reads the transform data from the PSD.

---

## Batch rendering

```ts
const tpl = await PsdTemplate.load("./template.psd");

for (const item of myDataset) {
  await tpl.render(
    {
      texts:  [{ layerName: "Title", text: item.title }],
      images: [{ layerName: "Hero", imagePath: item.heroPath, fit: "cover" }],
    },
    { outputPath: `./output/${item.id}.png` }
  );
}
```

Each `render()` call is independent — no state leaks between iterations.

---

## Blending mode support

ImageMagick supports all standard Photoshop blending modes:

| Supported ✅ | Notes |
|---|---|
| Normal, Dissolve | — |
| Multiply, Screen, Overlay | — |
| Soft Light, Hard Light | — |
| Color Dodge, Color Burn | — |
| Darken, Lighten | — |
| Difference, Exclusion | — |
| Hue, Saturation, Color, Luminosity | — |

> Layer effects like **Drop Shadow**, **Inner Glow**, **Gradient Overlay** are also preserved through the PSD format.

---

## Limitations

- **Text rendering**: ag-psd patches the text *data* but does not rasterize the text itself. The rasterization is done by ImageMagick using Ghostscript fonts. Complex OpenType features (ligatures, variable fonts) may not render identically to Photoshop. For pixel-perfect text, the best approach is to have Photoshop rasterize — i.e. use this library for everything *except* the final render, and call Photoshop's own CLI/scripting if you have a license.
- **Smart object filters**: Smart object *filters* (e.g. a Blur applied inside the smart object) are not re-applied. The replacement image is used as-is.
- **Adjustment layers**: Rendered correctly by ImageMagick for standard types (Levels, Curves, Hue/Saturation). Some advanced types (Color Lookup, Gradient Map) may be ignored.
