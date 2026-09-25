/**
 * generate-placeholders.mjs
 *
 * Generates visually distinct 2400–3200×600px achromatic placeholder images
 * for all 13 story segments × 3 layers (bg, mg, fg).
 *
 * Each segment has a unique scene identity:
 *   seg01 — HOME        (suburb, houses, gardens)
 *   seg02 — OPEN ROAD   (telegraph poles, open sky)
 *   seg03 — MOUNTAINS   (jagged peaks, pine trees)
 *   seg04 — SUMMIT      (dramatic drop, exposed ridge)
 *   seg05 — VILLAGE     (church spire, rooftops)
 *   seg06 — SHACK AREA  (tilted shacks, dusty ground)
 *   seg07 — BOATYARD    (mast poles, water edge)
 *   seg08 — WATER       (bridge, flat water band)
 *   seg09 — FAR SHORE   (gentle slope, lone trees)
 *   seg10 — STATION     (platform, clock tower)
 *   seg11 — CANYON      (tall cliff walls, narrow sky)
 *   seg12 — CITY        (dense skyline, tall blocks)
 *   seg13 — PARK        (rounded trees, open grass)
 *
 * Requires: canvas npm package (npm install --save-dev canvas)
 * Run: node scripts/generate-placeholders.mjs
 */

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, "../public/assets");

const SEG_HEIGHT = 600;

// ---------------------------------------------------------------------------
// Segment definitions
// ---------------------------------------------------------------------------

const segments = [
  { id: "seg01", label: "HOME",          scene: "suburb",    width: 3200, bgGray: 210, mgGray: 155, fgGray: 68 },
  { id: "seg02", label: "OPEN ROAD",     scene: "road",      width: 3200, bgGray: 218, mgGray: 165, fgGray: 72 },
  { id: "seg03", label: "MOUNTAINS",     scene: "mountain",  width: 3200, bgGray: 195, mgGray: 130, fgGray: 52 },
  { id: "seg04", label: "SUMMIT",        scene: "summit",    width: 3200, bgGray: 230, mgGray: 175, fgGray: 82 },
  { id: "seg05", label: "VILLAGE",       scene: "village",   width: 2800, bgGray: 205, mgGray: 148, fgGray: 62 },
  { id: "seg06", label: "SHACK AREA",    scene: "shack",     width: 2800, bgGray: 172, mgGray: 112, fgGray: 42 },
  { id: "seg07", label: "BOATYARD",      scene: "boatyard",  width: 2400, bgGray: 185, mgGray: 128, fgGray: 50 },
  { id: "seg08", label: "WATER",         scene: "water",     width: 3200, bgGray: 202, mgGray: 158, fgGray: 72 },
  { id: "seg09", label: "FAR SHORE",     scene: "shore",     width: 2400, bgGray: 212, mgGray: 158, fgGray: 68 },
  { id: "seg10", label: "TRAIN STOP",    scene: "station",   width: 2400, bgGray: 198, mgGray: 138, fgGray: 58 },
  { id: "seg11", label: "CANYON",        scene: "canyon",    width: 3200, bgGray: 155, mgGray:  95, fgGray: 35 },
  { id: "seg12", label: "NEW CITY",      scene: "city",      width: 3200, bgGray: 192, mgGray: 132, fgGray: 52 },
  { id: "seg13", label: "PARK",          scene: "park",      width: 2400, bgGray: 215, mgGray: 162, fgGray: 74 },
];

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function horizon(layer, H) {
  if (layer === "bg") return H * 0.38;
  if (layer === "mg") return H * 0.54;
  return H * 0.70;
}

function drawBg(ctx, scene, W, H, gray, segIdx) {
  // Sky gradient — lighter at top, slightly darker at horizon
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  skyGrad.addColorStop(0,   `rgb(${gray + 22},${gray + 22},${gray + 22})`);
  skyGrad.addColorStop(1,   `rgb(${gray},${gray},${gray})`);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Ground
  ctx.fillStyle = `rgb(${gray - 18},${gray - 18},${gray - 18})`;
  ctx.fillRect(0, horizon("bg", H), W, H - horizon("bg", H));

  // Horizon line
  ctx.strokeStyle = `rgba(0,0,0,0.18)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, horizon("bg", H)); ctx.lineTo(W, horizon("bg", H)); ctx.stroke();

  const hz = horizon("bg", H);
  ctx.fillStyle = `rgba(0,0,0,0.22)`;

  switch (scene) {
    case "mountain":
    case "summit": {
      // Jagged mountain silhouette
      ctx.beginPath();
      ctx.moveTo(0, hz);
      const peaks = scene === "summit" ? 3 : 6;
      for (let i = 0; i <= peaks; i++) {
        const x = (i / peaks) * W;
        const peakH = 110 + Math.sin(i * 2.3 + segIdx) * 50;
        const midX = x - (W / peaks) * 0.5;
        ctx.lineTo(midX, hz - peakH);
        ctx.lineTo(x, hz - 20);
      }
      ctx.lineTo(W, hz);
      ctx.fill();
      break;
    }
    case "city": {
      // Dense skyline rectangles
      for (let x = 20; x < W; x += 55 + (segIdx * 7) % 30) {
        const h = 60 + Math.sin(x / 80) * 40 + (x % 70) * 0.4;
        ctx.fillRect(x, hz - h, 45, h);
        // Window grid
        ctx.fillStyle = `rgba(255,255,255,0.05)`;
        for (let wy = hz - h + 8; wy < hz - 10; wy += 12) {
          for (let wx = x + 6; wx < x + 39; wx += 12) {
            ctx.fillRect(wx, wy, 6, 7);
          }
        }
        ctx.fillStyle = `rgba(0,0,0,0.22)`;
      }
      break;
    }
    case "canyon": {
      // Cliff walls rising from both sides
      const cliffH = hz * 0.7;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, hz); ctx.lineTo(W * 0.28, hz);
      ctx.lineTo(W * 0.25, hz - cliffH); ctx.lineTo(0, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W, 0); ctx.lineTo(W, hz); ctx.lineTo(W * 0.72, hz);
      ctx.lineTo(W * 0.75, hz - cliffH); ctx.lineTo(W, 0);
      ctx.fill();
      break;
    }
    default: {
      // Distant rolling hills
      ctx.beginPath();
      ctx.moveTo(0, hz);
      for (let x = 0; x <= W; x += 150) {
        const h = 40 + Math.sin((x + segIdx * 280) / 350) * 28;
        ctx.lineTo(x, hz - h);
      }
      ctx.lineTo(W, hz);
      ctx.fill();
    }
  }
}

function drawMg(ctx, scene, W, H, gray, segIdx) {
  const hz = horizon("mg", H);

  // Ground band
  ctx.fillStyle = `rgb(${gray - 12},${gray - 12},${gray - 12})`;
  ctx.fillRect(0, hz, W, H - hz);

  ctx.fillStyle = `rgba(0,0,0,0.25)`;

  switch (scene) {
    case "suburb": {
      // House silhouettes with roofs
      for (let x = 60 + (segIdx * 40) % 80; x < W - 40; x += 160 + (x % 50)) {
        const hw = 70 + (x % 30);
        const hh = 55 + (x % 20);
        ctx.fillRect(x, hz - hh, hw, hh);
        // Roof
        ctx.beginPath();
        ctx.moveTo(x - 8, hz - hh);
        ctx.lineTo(x + hw / 2, hz - hh - 30);
        ctx.lineTo(x + hw + 8, hz - hh);
        ctx.fill();
        // Window
        ctx.fillStyle = `rgba(255,255,255,0.06)`;
        ctx.fillRect(x + 18, hz - hh + 12, 16, 14);
        ctx.fillRect(x + 42, hz - hh + 12, 16, 14);
        ctx.fillStyle = `rgba(0,0,0,0.25)`;
      }
      break;
    }
    case "road": {
      // Telegraph poles
      for (let x = 80 + (segIdx * 60) % 120; x < W; x += 220) {
        const ph = 95 + (x % 20);
        ctx.fillRect(x - 3, hz - ph, 6, ph);
        ctx.fillRect(x - 22, hz - ph + 8, 44, 5); // crossbar
        // Wire suggestions
        ctx.strokeStyle = `rgba(0,0,0,0.15)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 22, hz - ph + 10);
        ctx.quadraticCurveTo(x + 98, hz - ph + 18, x + 220 - 22, hz - (95 + ((x + 220) % 20)) + 10);
        ctx.stroke();
        ctx.fillStyle = `rgba(0,0,0,0.25)`;
      }
      break;
    }
    case "mountain":
    case "summit": {
      // Pine tree silhouettes
      for (let x = 40 + (segIdx * 35) % 70; x < W; x += 90 + (x % 40)) {
        const th = 65 + Math.sin(x / 80) * 20;
        // Triangle tree
        ctx.beginPath();
        ctx.moveTo(x, hz - th);
        ctx.lineTo(x - 18, hz);
        ctx.lineTo(x + 18, hz);
        ctx.fill();
        ctx.fillRect(x - 4, hz, 8, 10);
      }
      break;
    }
    case "village": {
      // Mixed houses + church spire
      for (let x = 50; x < W; x += 140 + (x % 50)) {
        const isChurch = (x / 140) % 3 < 1;
        if (isChurch) {
          ctx.fillRect(x, hz - 70, 50, 70);
          // Spire
          ctx.beginPath();
          ctx.moveTo(x + 25, hz - 120);
          ctx.lineTo(x + 10, hz - 72);
          ctx.lineTo(x + 40, hz - 72);
          ctx.fill();
        } else {
          const hw = 55 + (x % 25);
          const hh = 45 + (x % 18);
          ctx.fillRect(x, hz - hh, hw, hh);
          ctx.beginPath();
          ctx.moveTo(x - 5, hz - hh);
          ctx.lineTo(x + hw / 2, hz - hh - 25);
          ctx.lineTo(x + hw + 5, hz - hh);
          ctx.fill();
        }
      }
      break;
    }
    case "shack": {
      // Low irregular rectangles, some tilted
      for (let x = 40 + (segIdx * 28) % 60; x < W - 30; x += 120 + (x % 40)) {
        const sw = 55 + (x % 30);
        const sh = 28 + (x % 15);
        ctx.save();
        ctx.translate(x + sw / 2, hz - sh / 2);
        ctx.rotate(((x % 7) - 3) * 0.03);
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
        // Corrugated roof texture hint
        ctx.strokeStyle = `rgba(255,255,255,0.06)`;
        ctx.lineWidth = 2;
        for (let rx = -sw / 2; rx < sw / 2; rx += 6) {
          ctx.beginPath(); ctx.moveTo(rx, -sh / 2); ctx.lineTo(rx, -sh / 2 - 6); ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = `rgba(0,0,0,0.25)`;
      }
      break;
    }
    case "boatyard": {
      // Mast poles with diagonal rigging
      for (let x = 80 + (segIdx * 45) % 90; x < W; x += 180 + (x % 60)) {
        const mh = 110 + (x % 30);
        ctx.fillRect(x - 4, hz - mh, 8, mh);
        // Boom
        ctx.fillRect(x - 30, hz - mh + 20, 60, 4);
        // Rigging lines
        ctx.strokeStyle = `rgba(0,0,0,0.2)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, hz - mh); ctx.lineTo(x - 35, hz - 15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, hz - mh); ctx.lineTo(x + 35, hz - 15); ctx.stroke();
        ctx.fillStyle = `rgba(0,0,0,0.25)`;
      }
      break;
    }
    case "water": {
      // Bridge structure
      const bridgeY = hz - 25;
      ctx.fillRect(0, bridgeY, W, 8);
      // Supports every 200px
      for (let x = 100; x < W; x += 200) {
        ctx.fillRect(x - 6, bridgeY, 12, H - bridgeY);
        // Arch hint
        ctx.beginPath();
        ctx.arc(x, bridgeY + 5, 50, Math.PI, 0);
        ctx.stroke();
      }
      // Water surface with gentle ripples
      ctx.fillStyle = `rgba(255,255,255,0.06)`;
      for (let wx = 0; wx < W; wx += 35) {
        ctx.beginPath();
        ctx.moveTo(wx, hz + 15);
        ctx.quadraticCurveTo(wx + 17, hz + 12, wx + 35, hz + 15);
        ctx.stroke();
      }
      break;
    }
    case "shore": {
      // Gentle sloped bank + individual trees
      ctx.beginPath();
      ctx.moveTo(0, hz + 30);
      ctx.quadraticCurveTo(W * 0.3, hz - 10, W, hz);
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.fill();
      // Trees
      for (let x = 120; x < W; x += 250 + (x % 80)) {
        const th = 55 + (x % 20);
        ctx.beginPath();
        ctx.arc(x, hz - th, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - 4, hz - th + 10, 8, th - 10);
      }
      break;
    }
    case "station": {
      // Long platform + clock tower
      ctx.fillRect(0, hz - 12, W, 12);
      ctx.fillRect(W * 0.3 - 15, hz - 80, 30, 68);
      // Clock face
      ctx.strokeStyle = `rgba(255,255,255,0.15)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(W * 0.3, hz - 72, 14, 0, Math.PI * 2); ctx.stroke();
      // Canopy
      ctx.fillStyle = `rgba(0,0,0,0.18)`;
      for (let x = 0; x < W; x += 120) {
        ctx.fillRect(x, hz - 28, 100, 16);
        ctx.fillRect(x + 10, hz - 40, 6, 12);
        ctx.fillRect(x + 84, hz - 40, 6, 12);
      }
      ctx.fillStyle = `rgba(0,0,0,0.25)`;
      break;
    }
    case "canyon": {
      // Canyon walls at mid
      const cwH = hz * 0.55;
      ctx.fillRect(0, hz - cwH, W * 0.22, cwH);
      ctx.fillRect(W * 0.78, hz - cwH, W * 0.22, cwH);
      // Rock strata lines
      for (let ly = 0; ly < cwH; ly += 18) {
        ctx.strokeStyle = `rgba(255,255,255,0.05)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, hz - cwH + ly);
        ctx.lineTo(W * 0.22, hz - cwH + ly);
        ctx.moveTo(W * 0.78, hz - cwH + ly);
        ctx.lineTo(W, hz - cwH + ly);
        ctx.stroke();
      }
      break;
    }
    case "city": {
      // Mid-ground buildings, narrower
      for (let x = 10; x < W; x += 45 + (x % 30)) {
        const h = 50 + Math.sin(x / 60) * 30 + (x % 40);
        ctx.fillRect(x, hz - h, 38, h);
      }
      break;
    }
    case "park": {
      // Rounded tree blobs on stems
      for (let x = 60 + (segIdx * 30) % 70; x < W; x += 130 + (x % 50)) {
        const th = 50 + (x % 20);
        const tr = 22 + (x % 10);
        // Stem
        ctx.fillRect(x - 4, hz - th + tr, 8, th - tr);
        // Canopy blob
        ctx.beginPath();
        ctx.arc(x, hz - th, tr, 0, Math.PI * 2);
        ctx.fill();
        // Second overlapping blob for organic shape
        ctx.beginPath();
        ctx.arc(x + tr * 0.4, hz - th + tr * 0.3, tr * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}

function drawFg(ctx, scene, W, H, gray, segIdx) {
  const hz = horizon("fg", H);

  // Road/path strip
  const pathGray = gray - 8;
  ctx.fillStyle = `rgb(${pathGray},${pathGray},${pathGray})`;
  ctx.fillRect(0, hz, W, H - hz);

  // Horizon line
  ctx.strokeStyle = `rgba(0,0,0,0.2)`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(W, hz); ctx.stroke();

  ctx.fillStyle = `rgba(0,0,0,0.28)`;

  switch (scene) {
    case "water": {
      // Water surface — lighter, with ripple hints
      ctx.fillStyle = `rgb(${gray + 15},${gray + 15},${gray + 15})`;
      ctx.fillRect(0, hz, W, H - hz);
      ctx.strokeStyle = `rgba(255,255,255,0.1)`;
      ctx.lineWidth = 1;
      for (let wx = 0; wx < W; wx += 28) {
        ctx.beginPath();
        ctx.moveTo(wx, hz + 8);
        ctx.quadraticCurveTo(wx + 14, hz + 5, wx + 28, hz + 8);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(0,0,0,0.28)`;
      break;
    }
    case "canyon": {
      // Rock floor
      ctx.fillStyle = `rgb(${gray - 20},${gray - 20},${gray - 20})`;
      ctx.fillRect(0, hz, W, H - hz);
      ctx.fillStyle = `rgba(0,0,0,0.28)`;
      break;
    }
  }

  // Foreground elements — close to camera, high detail
  switch (scene) {
    case "suburb": {
      // Garden fence
      for (let x = 20 + (segIdx * 22) % 40; x < W; x += 28) {
        ctx.fillRect(x - 3, hz - 30, 6, 30);
        ctx.fillRect(x - 12, hz - 20, 24, 5);
      }
      break;
    }
    case "road": {
      // Roadside verge / grass tufts
      for (let x = 15 + (segIdx * 18) % 30; x < W; x += 55) {
        ctx.fillRect(x - 2, hz - 18, 4, 18);
        // Tuft lines
        ctx.strokeStyle = `rgba(0,0,0,0.25)`;
        ctx.lineWidth = 2;
        for (let i = -8; i <= 8; i += 4) {
          ctx.beginPath();
          ctx.moveTo(x + i, hz);
          ctx.lineTo(x + i - 3, hz - 14);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(0,0,0,0.28)`;
      }
      break;
    }
    case "mountain":
    case "summit": {
      // Rocky ground
      for (let x = 30 + (segIdx * 25) % 50; x < W; x += 80 + (x % 40)) {
        ctx.beginPath();
        ctx.ellipse(x, hz + 8, 18 + (x % 10), 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "village":
    case "suburb": {
      // Low stone wall
      for (let x = 0; x < W; x += 18) {
        const bh = 14 + (x % 6);
        ctx.fillRect(x, hz - bh, 16, bh);
        ctx.fillStyle = `rgba(255,255,255,0.04)`;
        ctx.fillRect(x + 1, hz - bh + 1, 14, 3);
        ctx.fillStyle = `rgba(0,0,0,0.28)`;
      }
      break;
    }
    case "shack": {
      // Tyre tracks / ruts in dusty ground
      ctx.strokeStyle = `rgba(0,0,0,0.18)`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, hz + 18); ctx.lineTo(W, hz + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, hz + 32); ctx.lineTo(W, hz + 35); ctx.stroke();
      // Scattered debris dots
      ctx.fillStyle = `rgba(0,0,0,0.2)`;
      for (let x = 40 + (segIdx * 33) % 60; x < W; x += 90 + (x % 50)) {
        ctx.beginPath(); ctx.ellipse(x, hz + 12, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case "boatyard": {
      // Dock planks
      for (let x = 0; x < W; x += 20) {
        ctx.fillRect(x, hz, 18, H - hz);
        ctx.fillStyle = `rgba(255,255,255,0.03)`;
        ctx.fillRect(x, hz, 18, 2);
        ctx.fillStyle = `rgba(0,0,0,0.28)`;
      }
      break;
    }
    case "station": {
      // Platform edge + tracks
      ctx.strokeStyle = `rgba(255,255,255,0.12)`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, hz + 20); ctx.lineTo(W, hz + 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, hz + 35); ctx.lineTo(W, hz + 35); ctx.stroke();
      // Sleepers
      for (let x = 0; x < W; x += 32) {
        ctx.strokeStyle = `rgba(0,0,0,0.15)`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x + 2, hz + 18); ctx.lineTo(x + 2, hz + 38); ctx.stroke();
      }
      break;
    }
    case "park": {
      // Grass path stones
      for (let x = 40 + (segIdx * 20) % 40; x < W; x += 70) {
        ctx.beginPath();
        ctx.ellipse(x, hz + 10, 12, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "city": {
      // Pavement/kerb
      ctx.fillRect(0, hz, W, 8);
      ctx.fillStyle = `rgba(255,255,255,0.05)`;
      for (let x = 0; x < W; x += 40) ctx.fillRect(x, hz, 38, 2);
      break;
    }
    default: {
      // Generic fence posts
      for (let x = 30 + (segIdx * 20) % 40; x < W; x += 60) {
        ctx.fillRect(x - 3, hz - 35, 6, 35);
        ctx.fillRect(x - 22, hz - 22, 44, 5);
      }
    }
  }

  // Label
  ctx.fillStyle = `rgba(0,0,0,0.3)`;
  ctx.font = `bold 26px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(scene.toUpperCase(), W / 2, H - 20);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const dir = join(assetsDir, seg.id);
  mkdirSync(dir, { recursive: true });

  const layers = [
    { name: "bg", gray: seg.bgGray, drawFn: drawBg },
    { name: "mg", gray: seg.mgGray, drawFn: drawMg },
    { name: "fg", gray: seg.fgGray, drawFn: drawFg },
  ];

  for (const { name, gray, drawFn } of layers) {
    const W = seg.width;
    const H = SEG_HEIGHT;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // Base fill
    ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
    ctx.fillRect(0, 0, W, H);

    drawFn(ctx, seg.scene, W, H, gray, i);

    // Segment label in corner (top-left, small)
    ctx.fillStyle = `rgba(0,0,0,0.18)`;
    ctx.font = `14px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`${seg.id} · ${seg.label} · ${name}`, 12, 18);

    const buf = canvas.toBuffer("image/png");

    writeFileSync(join(dir, `${name}.webp`), buf);
    writeFileSync(join(dir, `${name}@0.5x.webp`), buf);
    process.stdout.write(`  ✓ ${seg.id}/${name}.webp\n`);
  }
}

process.stdout.write("\nDone — all 13 segments generated.\n");
