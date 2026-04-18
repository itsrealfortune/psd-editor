/**
 * example.ts — Usage examples for psd-template
 *
 * Run with: npx ts-node examples/example.ts
 */

import { PsdTemplate } from "../src/index.js";

async function main() {
  // ── 1. Load the template ────────────────────────────────────────────────
  const tpl = await PsdTemplate.load("./my-template.psd");

  // ── 2. Discover layer names (run this first to find the exact names) ────
  //
  // Output looks like:
  //   [group]       Background Group
  //     [image]     Background Texture
  //   [text]        Title           → "Original title text"
  //   [text]        Subtitle        → "Original subtitle"
  //   [smartObject] Hero Photo      [linked: photo.psb]
  //   [smartObject] Logo            [linked: logo.psb]
  //
  tpl.printLayers();

  // Or get it as structured data:
  const layerInfo = tpl.inspectLayers();
  const textLayers = layerInfo.filter((l) => l.type === "text");
  console.log("Text layers:", textLayers.map((l) => l.name));

  // ── 3. Render with replacements ─────────────────────────────────────────
  await tpl.render(
    {
      // Text replacements — match layer names EXACTLY (case-sensitive)
      texts: [
        {
          layerName: "Title",
          text: "Summer Collection 2025",
        },
        {
          layerName: "Subtitle",
          text: "Up to 50% off",
          fontSize: 24,
          color: [255, 220, 0], // RGB — yellow
        },
        {
          layerName: "CTA Button Text",
          text: "Shop Now →",
        },
      ],

      // Image replacements — works for regular image layers AND smart objects
      images: [
        {
          layerName: "Hero Photo",
          imagePath: "./assets/new-hero.jpg",
          fit: "cover", // crop to fill the layer bounds (default)
        },
        {
          layerName: "Logo",
          imagePath: "./assets/logo.png",
          fit: "contain", // preserve aspect ratio, letterbox if needed
        },
      ],
    },
    {
      outputPath: "./output/result.png",
      scale: 1,           // 1 = 100%, 0.5 = half size, 2 = double
      compressionLevel: 6, // PNG compression 0 (none) to 9 (max)
    }
  );

  // ── 4. Batch rendering example ──────────────────────────────────────────
  //
  // Because render() re-reads the original PSD each time, you can call it
  // in a loop without creating a new PsdTemplate instance.
  //

  const variants = [
    { title: "Paris Edition",   hero: "./assets/paris.jpg",   out: "./output/paris.png" },
    { title: "Tokyo Edition",   hero: "./assets/tokyo.jpg",   out: "./output/tokyo.png" },
    { title: "New York Edition", hero: "./assets/newyork.jpg", out: "./output/newyork.png" },
  ];

  for (const variant of variants) {
    await tpl.render(
      {
        texts: [{ layerName: "Title", text: variant.title }],
        images: [{ layerName: "Hero Photo", imagePath: variant.hero, fit: "cover" }],
      },
      { outputPath: variant.out }
    );
  }

  console.log("All done!");
}

main().catch(console.error);
