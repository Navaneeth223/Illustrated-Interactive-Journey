/**
 * generate-placeholders.mjs
 *
 * Generates colored placeholder WebP/PNG images for each segment layer.
 * Each segment gets a distinct hue; each layer (bg/mg/fg) gets a different
 * lightness so parallax depth is visible.
 *
 * Requires: npm install --save-dev sharp
 * Run:      node scripts/generate-placeholders.mjs
 */

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, "../public/assets");

// Segment configs: each gets a label and grayscale tone range
const segments = [
  { id: "seg01", label: "DEPARTURE",     bgGray: 200, mgGray: 140, fgGray: 60  },
  { id: "seg02", label: "OPEN ROAD",     bgGray: 210, mgGray: 150, fgGray: 70  },
  { id: "seg03", label: "TOWN EDGE",     bgGray: 195, mgGray: 130, fgGray: 55  },
  { id: "seg04", label: "FIELDS",        bgGray: 215, mgGray: 155, fgGray: 75  },
  { id: "seg05", label: "RIVER",         bgGray: 205, mgGray: 145, fgGray: 65  },
  { id: "seg06", label: "HILL CLIMB",    bgGray: 190, mgGray: 125, fgGray: 50  },
  { id: "seg07", label: "DESCENT",       bgGray: 200, mgGray: 135, fgGray: 58  },
  { id: "seg08", label: "ARRIVAL",       bgGray: 220, mgGray: 160, fgGray: 80  },
];

const WIDTH  = 2400;
const HEIGHT = 600;

function drawLayer(gray, label, layerName, segIndex) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Base fill
  ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Horizon line (darker stripe)
  const horizY = layerName === "bg" ? HEIGHT * 0.4 :
                 layerName === "mg" ? HEIGHT * 0.55 : HEIGHT * 0.7;
  ctx.fillStyle = `rgba(0,0,0,0.15)`;
  ctx.fillRect(0, horizY - 2, WIDTH, 4);

  // Simple silhouette shapes per layer
  ctx.fillStyle = `rgba(0,0,0,0.2)`;
  if (layerName === "bg") {
    // Distant rolling hills
    ctx.beginPath();
    ctx.moveTo(0, horizY);
    for (let x = 0; x <= WIDTH; x += 200) {
      const h = 60 + Math.sin((x + segIndex * 300) / 400) * 40;
      ctx.lineTo(x, horizY - h);
    }
    ctx.lineTo(WIDTH, horizY);
    ctx.fill();
  } else if (layerName === "mg") {
    // Trees / buildings
    for (let x = 80 + segIndex * 50; x < WIDTH; x += 220) {
      const h = 80 + Math.sin(x / 150) * 30;
      ctx.fillRect(x - 15, horizY - h, 30, h);
      ctx.beginPath();
      ctx.arc(x, horizY - h - 20, 35, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Foreground fence posts / grass tufts
    for (let x = 40 + segIndex * 30; x < WIDTH; x += 80) {
      ctx.fillRect(x - 3, horizY - 40, 6, 40);
      ctx.fillRect(x - 20, horizY - 25, 40, 5);
    }
  }

  // Label text
  ctx.fillStyle = `rgba(0,0,0,0.35)`;
  ctx.font = `bold ${layerName === "fg" ? 28 : 22}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`${label} · ${layerName.toUpperCase()}`, WIDTH / 2, HEIGHT - 24);

  return canvas.toBuffer("image/png");
}

// Check if canvas package is available
let createCanvasFn;
try {
  const mod = await import("canvas");
  createCanvasFn = mod.createCanvas;
} catch {
  console.error("canvas package not found. Run: npm install --save-dev canvas");
  process.exit(1);
}

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const dir = join(assetsDir, seg.id);
  mkdirSync(dir, { recursive: true });

  for (const [layerName, gray] of [["bg", seg.bgGray], ["mg", seg.mgGray], ["fg", seg.fgGray]]) {
    const buf = drawLayer(gray, seg.label, layerName, i);
    // Write as PNG (rename to .webp — browsers treat it the same for placeholders)
    writeFileSync(join(dir, `${layerName}.webp`), buf);
    // Half-res: write same image, browser will scale it
    writeFileSync(join(dir, `${layerName}@0.5x.webp`), buf);
    console.log(`  ✓ ${seg.id}/${layerName}.webp`);
  }
}
console.log("\nDone.");
