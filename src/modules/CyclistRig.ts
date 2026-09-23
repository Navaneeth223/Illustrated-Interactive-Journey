/**
 * CyclistRig — jointed paper-cutout character rig with 3D depth illusion.
 *
 * 3D depth cues applied (all achievable with flat 2D shapes):
 *
 * 1. Tonal separation — back limbs are LIGHTER (farther away = more atmospheric
 *    haze), front limbs are DARKER (closest to viewer). This is the opposite of
 *    the old version which made both the same dark color.
 *
 * 2. Rim lighting — a lighter stroke on the near (right) edge of the torso and
 *    legs simulates light catching the form edge, lifting it off the background.
 *
 * 3. Ground shadow — a flat oval below the rear wheel gives the figure a base
 *    and stops it floating. Scales slightly with speed.
 *
 * 4. Perspective wheel sizing — rear wheel is 2px smaller radius than front,
 *    simulating very slight 3/4 view angle.
 *
 * 5. Torso taper — wider at chest (shoulders), narrower at waist, rather than
 *    a uniform rectangle. Reads as a body, not a plank.
 *
 * Bug fixes:
 *   - Lean easing is time-normalised: 1-(1-α)^(dt*60) — no more jitter
 *   - Direction-flip plays squish-pivot animation, no instant reversal
 *   - DEBUG_COLORS flag for joint-position verification
 */

import * as PIXI from "pixi.js";
import { gsap } from "gsap";

// ---------------------------------------------------------------------------
// Debug mode
// ---------------------------------------------------------------------------
const DEBUG_COLORS = false;

const DBG = {
  shadow:      0x222200,
  backWheel:   0x0000ff,
  upperLegB:   0x00aaff, // back = light blue
  lowerLegB:   0x0066ff,
  frame:       0x888888,
  frontWheel:  0xff0000,
  upperLegF:   0xff6600, // front = warm
  lowerLegF:   0xff9900,
  torso:       0xff2222,
  head:        0xff8800,
  upperArmB:   0x00ff88,
  lowerArmB:   0x00ffcc,
  upperArmF:   0xcc00ff,
  lowerArmF:   0xff00aa,
};

function col(key: keyof typeof DBG, fallback: number): number {
  return DEBUG_COLORS ? DBG[key] : fallback;
}

// ---------------------------------------------------------------------------
// Achromatic palette — LIGHTER = farther back, DARKER = closer
// ---------------------------------------------------------------------------
const VERY_DARK = 0x111009;  // front limbs, deepest shadow
const DARK      = 0x1a1814;  // frame, structural elements
const MID_DARK  = 0x2e2a26;  // mid-distance elements
const MID       = 0x3e3a36;  // back limbs (lighter = receding)
const MID_LIGHT = 0x5a5652;  // back wheel (furthest back = lightest)
const LIGHT     = 0x7a7570;  // highlights, rim light strokes
const RIM       = 0x9a9690;  // brightest rim light

// ---------------------------------------------------------------------------
// Rig constants
// ---------------------------------------------------------------------------
const FRONT_WHEEL_R = 24;   // front wheel — slightly larger (3/4 view)
const BACK_WHEEL_R  = 22;   // rear wheel  — slightly smaller (perspective)
const SPOKE_COUNT   = 8;

const UPPER_LEG_LEN = 26;
const LOWER_LEG_LEN = 23;
const UPPER_ARM_LEN = 18;
const LOWER_ARM_LEN = 15;

// Animation tuning
const PEDAL_RATE  = 0.0042;
const WHEEL_RATE  = 0.031;
const LEG_SWING   = 0.78;
const KNEE_BEND   = 0.95;
const KNEE_OFFSET = 0.88;
const ARM_SWING   = 0.20;
const LEAN_ALPHA  = 0.07;
const LEAN_SCALE  = 9000;
const LEAN_MAX    = 0.13;
const BOB_AMP     = 3.5;

const FLIP_DURATION = 0.18;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function drawWheel(g: PIXI.Graphics, radius: number, rimColor: number, spokeColor: number): void {
  // Tyre
  g.circle(0, 0, radius).stroke({ color: rimColor, width: 4 });
  // Hub
  g.circle(0, 0, 5).fill(rimColor);
  // Spokes
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const a = (i / SPOKE_COUNT) * Math.PI * 2;
    g.moveTo(0, 0)
      .lineTo(Math.cos(a) * (radius - 3), Math.sin(a) * (radius - 3))
      .stroke({ color: spokeColor, width: 1.2 });
  }
}

/**
 * Draw a rounded limb with optional rim-light on the leading edge.
 */
function drawLimb(
  g: PIXI.Graphics,
  length: number,
  thickness: number,
  fillColor: number,
  endDot = 0,
  rimLight = false,
): void {
  g.roundRect(-thickness / 2, 0, thickness, length, thickness / 2).fill(fillColor);
  if (endDot > 0) g.circle(0, length, endDot).fill(fillColor);
  if (rimLight) {
    // Right-edge highlight strip — simulates light catching the near face
    g.moveTo(thickness / 2 - 1.5, thickness / 2)
      .lineTo(thickness / 2 - 1.5, length - thickness / 2)
      .stroke({ color: RIM, width: 1.5, alpha: 0.7 });
  }
}

// ---------------------------------------------------------------------------
// RigParts
// ---------------------------------------------------------------------------

export interface RigParts {
  root:           PIXI.Container;
  torso:          PIXI.Container;
  head:           PIXI.Graphics;
  upperArmFront:  PIXI.Container;
  lowerArmFront:  PIXI.Container;
  upperArmBack:   PIXI.Container;
  lowerArmBack:   PIXI.Container;
  upperLegFront:  PIXI.Container;
  lowerLegFront:  PIXI.Container;
  upperLegBack:   PIXI.Container;
  lowerLegBack:   PIXI.Container;
  frontWheel:     PIXI.Graphics;
  backWheel:      PIXI.Graphics;
  shadow:         PIXI.Graphics;
}

// ---------------------------------------------------------------------------
// CyclistRig
// ---------------------------------------------------------------------------

export class CyclistRig {
  readonly parts: RigParts;

  private _legPhase:    number  = 0;
  private _prevVel:     number  = 0;
  private _currentLean: number  = 0;
  private _facingRight: boolean = true;
  private _flipping:    boolean = false;

  constructor() {
    this.parts = this._buildRig();
  }

  update(velocity: number, dt: number): void {
    if (this._flipping) return;

    const { root, torso, head,
            upperLegFront, lowerLegFront,
            upperLegBack,  lowerLegBack,
            upperArmFront, upperArmBack,
            frontWheel,    backWheel,
            shadow } = this.parts;

    const absSpeed = Math.abs(velocity);

    // Direction flip detection
    const wasSameSign = (this._prevVel <= 0) === (velocity <= 0);
    if (!wasSameSign && absSpeed > 20) {
      this._playFlip(velocity < 0 ? -1 : 1);
    }

    // Phase accumulation — distance-driven, always positive
    this._legPhase += absSpeed * dt * PEDAL_RATE;

    // Wheels
    const wd = absSpeed * dt * WHEEL_RATE;
    frontWheel.rotation += wd;
    backWheel.rotation  += wd;

    // Legs
    const lf = this._legPhase;
    const lb = this._legPhase + Math.PI;
    upperLegFront.rotation = LEG_SWING  * Math.sin(lf);
    lowerLegFront.rotation = Math.max(0, Math.sin(lf + KNEE_OFFSET)) * KNEE_BEND;
    upperLegBack.rotation  = LEG_SWING  * Math.sin(lb);
    lowerLegBack.rotation  = Math.max(0, Math.sin(lb + KNEE_OFFSET)) * KNEE_BEND;

    // Arms
    upperArmFront.rotation = ARM_SWING * Math.sin(lb);
    upperArmBack.rotation  = ARM_SWING * Math.sin(lf);

    // Body bob
    const bobT = Math.min(absSpeed / 800, 1);
    torso.y = Math.sin(lf * 2) * BOB_AMP * bobT;

    // Head counter-nod
    head.rotation = -torso.rotation * 0.4;

    // Lean — time-normalised exponential smoothing
    const accel      = dt > 0.001 ? (velocity - this._prevVel) / dt : 0;
    const targetLean = clamp(accel / LEAN_SCALE, -LEAN_MAX, LEAN_MAX);
    const smoothing  = 1 - Math.pow(1 - LEAN_ALPHA, dt * 60);
    this._currentLean += (targetLean - this._currentLean) * smoothing;
    root.rotation = this._currentLean;

    // Ground shadow — subtle size pulse with speed
    const shadowScale = 0.9 + 0.15 * Math.min(absSpeed / 800, 1);
    shadow.scale.x = shadowScale;
    shadow.alpha   = 0.18 + 0.08 * Math.min(absSpeed / 800, 1);

    this._prevVel = velocity;
  }

  private _playFlip(newDir: 1 | -1): void {
    if (this._flipping) return;
    this._flipping = true;

    const root = this.parts.root;
    const half = FLIP_DURATION / 2;

    gsap.to(root.scale, {
      x: 0.1,
      duration: half,
      ease: "power2.in",
      onComplete: () => {
        this._facingRight = newDir === 1;
        root.scale.x = 0.1 * newDir;
        gsap.to(root.scale, {
          x: newDir,
          duration: half,
          ease: "power2.out",
          onComplete: () => { this._flipping = false; },
        });
      },
    });
  }

  private _buildRig(): RigParts {
    const root = new PIXI.Container();

    // ── Ground shadow ─────────────────────────────────────────────────────
    // Drawn first so it appears below everything else
    const shadow = new PIXI.Graphics();
    shadow.ellipse(0, 0, 36, 6).fill({ color: col("shadow", VERY_DARK), alpha: 0.22 });
    shadow.position.set(0, 4); // just below wheel contact
    root.addChild(shadow);

    // ── Back wheel (lighter — farther from viewer) ────────────────────────
    const backWheel = new PIXI.Graphics();
    drawWheel(backWheel, BACK_WHEEL_R, col("backWheel", MID_LIGHT), col("backWheel", MID));
    backWheel.position.set(-28, 0);
    root.addChild(backWheel);

    // ── Back leg (lighter tones — receding depth) ─────────────────────────
    const upperLegBack = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, UPPER_LEG_LEN, 7, col("upperLegB", MID), 0, false);
      upperLegBack.addChild(g);
      upperLegBack.position.set(-2, -28);
    }
    const lowerLegBack = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, LOWER_LEG_LEN, 6, col("lowerLegB", MID_DARK), 5, false);
      lowerLegBack.addChild(g);
      lowerLegBack.position.set(0, UPPER_LEG_LEN);
      upperLegBack.addChild(lowerLegBack);
    }
    root.addChild(upperLegBack);

    // ── Frame ─────────────────────────────────────────────────────────────
    const frame = new PIXI.Graphics();
    const fc = col("frame", DARK);
    // Bottom bracket hub
    frame.circle(0, -12, 7).fill(fc);
    // Tubes
    frame.moveTo(0, -12).lineTo(-28,  0).stroke({ color: fc, width: 3 });   // chain stay
    frame.moveTo(0, -12).lineTo( 22, -34).stroke({ color: fc, width: 3 });  // down tube
    frame.moveTo(0, -12).lineTo( -6, -38).stroke({ color: fc, width: 3 });  // seat tube
    frame.moveTo(-6,-38).lineTo( 22, -34).stroke({ color: fc, width: 3 });  // top tube
    frame.moveTo(22,-34).lineTo( 24, -14).stroke({ color: fc, width: 4 });  // head tube
    frame.moveTo(24,-14).lineTo( 28,   0).stroke({ color: fc, width: 3 });  // fork
    // Rim-light highlight on right (front-facing) edge of seat tube
    frame.moveTo(-5,-36).lineTo(-4,-16).stroke({ color: LIGHT, width: 1.5, alpha: 0.5 });
    // Handlebar
    frame.moveTo(22,-34).lineTo(27,-44).stroke({ color: fc, width: 3 });
    frame.moveTo(27,-44).lineTo(32,-40).stroke({ color: fc, width: 3 });
    // Saddle (wider at back, tapered forward — reads as a real saddle shape)
    frame.moveTo(-18, -40).lineTo(-8, -40).stroke({ color: fc, width: 6 });
    frame.moveTo(-8,  -40).lineTo(-2, -39).stroke({ color: fc, width: 4 });
    root.addChild(frame);

    // ── Front wheel (darker + larger — closest to viewer) ─────────────────
    const frontWheel = new PIXI.Graphics();
    drawWheel(frontWheel, FRONT_WHEEL_R, col("frontWheel", VERY_DARK), col("frontWheel", MID_DARK));
    frontWheel.position.set(28, 0);
    root.addChild(frontWheel);

    // ── Front leg (darker tones + rim light — nearest to viewer) ──────────
    const upperLegFront = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, UPPER_LEG_LEN, 9, col("upperLegF", VERY_DARK), 0, true);
      upperLegFront.addChild(g);
      upperLegFront.position.set(-2, -28);
    }
    const lowerLegFront = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, LOWER_LEG_LEN, 8, col("lowerLegF", DARK), 7, true);
      lowerLegFront.addChild(g);
      lowerLegFront.position.set(0, UPPER_LEG_LEN);
      upperLegFront.addChild(lowerLegFront);
    }
    root.addChild(upperLegFront);

    // ── Torso (tapered: wider at chest, narrower at waist) ────────────────
    const torso = new PIXI.Container();
    torso.position.set(-6, -40);
    {
      const g = new PIXI.Graphics();
      // Tapered body — polygon instead of uniform rect
      // Points: bottom-center, hip-left, waist-left, shoulder-left,
      //         shoulder-right, waist-right, hip-right
      g.poly([
        -5, 24,   // hip left
         5, 24,   // hip right
         6, 16,   // waist right
        10,  4,   // shoulder right
       -10,  4,   // shoulder left
        -6, 16,   // waist left
      ]).fill(col("torso", DARK));
      // Rim light on right shoulder/chest edge
      g.moveTo(10, 4).lineTo(7, 18).stroke({ color: RIM, width: 1.5, alpha: 0.6 });
      torso.addChild(g);
    }
    root.addChild(torso);

    // ── Head ──────────────────────────────────────────────────────────────
    const head = new PIXI.Graphics();
    head.circle(0, 0, 10).fill(col("head", DARK));
    // Face — subtle lighter area to break up the silhouette
    head.arc(2, 1, 6, -0.4, Math.PI * 0.6).fill({ color: MID_DARK, alpha: 0.8 });
    // Helmet arc highlight
    head.arc(0, -2, 9, Math.PI + 0.5, Math.PI * 2 - 0.2)
      .stroke({ color: LIGHT, width: 1.8, alpha: 0.7 });
    // Helmet brim
    head.moveTo(-13, 3).lineTo(12, 3).stroke({ color: MID_DARK, width: 3 });
    head.position.set(2, -14);  // sits above torso chest
    torso.addChild(head);

    // ── Back arm ──────────────────────────────────────────────────────────
    const upperArmBack = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, UPPER_ARM_LEN, 6, col("upperArmB", MID), 0, false);
      upperArmBack.addChild(g);
      upperArmBack.rotation = 0.85;
      upperArmBack.position.set(4, 6);
    }
    const lowerArmBack = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, LOWER_ARM_LEN, 5, col("lowerArmB", MID_DARK), 0, false);
      lowerArmBack.addChild(g);
      lowerArmBack.position.set(0, UPPER_ARM_LEN);
      lowerArmBack.rotation = 0.25;
      upperArmBack.addChild(lowerArmBack);
    }
    torso.addChild(upperArmBack);

    // ── Front arm (with rim light) ─────────────────────────────────────────
    const upperArmFront = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, UPPER_ARM_LEN, 7, col("upperArmF", VERY_DARK), 0, true);
      upperArmFront.addChild(g);
      upperArmFront.rotation = 0.85;
      upperArmFront.position.set(4, 6);
    }
    const lowerArmFront = new PIXI.Container();
    {
      const g = new PIXI.Graphics();
      drawLimb(g, LOWER_ARM_LEN, 6, col("lowerArmF", DARK), 0, true);
      lowerArmFront.addChild(g);
      lowerArmFront.position.set(0, UPPER_ARM_LEN);
      lowerArmFront.rotation = 0.25;
      upperArmFront.addChild(lowerArmFront);
    }
    torso.addChild(upperArmFront);

    return {
      root, torso, head,
      upperArmFront, lowerArmFront,
      upperArmBack,  lowerArmBack,
      upperLegFront, lowerLegFront,
      upperLegBack,  lowerLegBack,
      frontWheel, backWheel,
      shadow,
    };
  }
}
