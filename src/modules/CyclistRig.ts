/**
 * CyclistRig — a fully-jointed paper-cutout character rig.
 *
 * Bug fixes applied:
 *   1. Lean easing is now time-normalised: 1 - (1-α)^(dt*60)
 *      so it converges identically at 30fps and 120fps.
 *   2. Direction-flip (TURNING state): when velocity crosses zero, the rig
 *      plays a short skid/pivot — scaleX tweens to 0, flips, tweens back to 1
 *      — before the world starts scrolling in the new direction.
 *   3. Debug-color mode: set DEBUG_COLORS = true to assign each part a
 *      distinct hue so joint positioning can be verified visually.
 */

import * as PIXI from "pixi.js";
import { gsap } from "gsap";

// ---------------------------------------------------------------------------
// Debug flag — set true to assign each part a distinct color
// ---------------------------------------------------------------------------
const DEBUG_COLORS = false;

const DBG = {
  torso:       0xff2222, // red
  head:        0xff8800, // orange
  upperLegF:   0xffff00, // yellow
  lowerLegF:   0x88ff00, // lime
  upperLegB:   0x00ffcc, // teal
  lowerLegB:   0x0088ff, // blue
  upperArmF:   0xcc00ff, // purple
  lowerArmF:   0xff00aa, // pink
  upperArmB:   0x00ff44, // green
  lowerArmB:   0xffffff, // white
  frame:       0x888888, // grey
  wheel:       0x444444, // dark grey
};

// ---------------------------------------------------------------------------
// Production colors (achromatic graphite)
// ---------------------------------------------------------------------------
const DARK  = 0x1a1814;
const MID   = 0x3a3530;
const LIGHT = 0x7a7570;

// ---------------------------------------------------------------------------
// Rig constants
// ---------------------------------------------------------------------------
const WHEEL_RADIUS  = 24;
const SPOKE_COUNT   = 8;
const UPPER_LEG_LEN = 24;
const LOWER_LEG_LEN = 22;
const UPPER_ARM_LEN = 16;
const LOWER_ARM_LEN = 14;

// Animation tuning
const PEDAL_RATE  = 0.0042;  // legPhase per px travelled
const WHEEL_RATE  = 0.031;   // wheel rotation per px travelled
const LEG_SWING   = 0.75;    // upper-leg amplitude (rad)
const KNEE_BEND   = 0.95;    // lower-leg max bend
const KNEE_OFFSET = 0.85;    // phase offset for knee
const ARM_SWING   = 0.22;    // upper-arm amplitude
const LEAN_ALPHA  = 0.07;    // lean smoothing factor (per 60fps frame equivalent)
const LEAN_SCALE  = 9000;    // acceleration → lean divisor
const LEAN_MAX    = 0.13;    // lean clamp (rad)
const BOB_AMP     = 3.5;     // max body-bob px

// Direction-flip animation
const FLIP_DURATION = 0.18;  // seconds to squish-then-flip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function col(key: keyof typeof DBG, fallback: number): number {
  return DEBUG_COLORS ? DBG[key] : fallback;
}

function drawWheel(g: PIXI.Graphics): void {
  const c = col("wheel", DARK);
  const s = col("wheel", MID);
  g.circle(0, 0, WHEEL_RADIUS).stroke({ color: c, width: 4 });
  g.circle(0, 0, 5).fill(c);
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const a = (i / SPOKE_COUNT) * Math.PI * 2;
    g.moveTo(0, 0)
      .lineTo(Math.cos(a) * (WHEEL_RADIUS - 3), Math.sin(a) * (WHEEL_RADIUS - 3))
      .stroke({ color: s, width: 1.5 });
  }
}

function drawLimb(
  g: PIXI.Graphics,
  length: number,
  thickness: number,
  color: number,
  endDot = 0,
): void {
  g.roundRect(-thickness / 2, 0, thickness, length, thickness / 2).fill(color);
  if (endDot > 0) g.circle(0, length, endDot).fill(color);
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
}

// ---------------------------------------------------------------------------
// CyclistRig
// ---------------------------------------------------------------------------

export class CyclistRig {
  readonly parts: RigParts;

  // Animation state
  private _legPhase:    number  = 0;
  private _prevVel:     number  = 0;
  private _currentLean: number  = 0;
  private _facingRight: boolean = true;
  private _flipping:    boolean = false;

  constructor() {
    this.parts = this._buildRig();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Advance the rig by one frame.
   *
   * @param velocity  Current world velocity px/s (signed — negative = backward).
   * @param dt        Elapsed seconds since last frame.
   */
  update(velocity: number, dt: number): void {
    if (this._flipping) return; // freeze animation during the flip squish

    const { root, torso, head,
            upperLegFront, lowerLegFront,
            upperLegBack,  lowerLegBack,
            upperArmFront, upperArmBack,
            frontWheel,    backWheel } = this.parts;

    const absSpeed = Math.abs(velocity);

    // ── Direction flip detection ──────────────────────────────────────────
    // When velocity crosses zero (previous frame same sign, this frame
    // opposite sign), play the squish-flip animation rather than instantly
    // reversing.
    const wasPosOrZero = this._prevVel >= 0;
    const wasSameSign  = this._prevVel <= 0 === velocity <= 0;

    if (!wasSameSign && absSpeed > 20) {
      // Velocity just crossed zero with meaningful speed → play flip.
      const targetDir = velocity < 0 ? -1 : 1;
      this._playFlip(targetDir);
    }

    // Determine facing for phase direction
    const dir = this._facingRight ? 1 : -1;

    // ── Phase accumulation ─────────────────────────────────────────────────
    // Always advance by |velocity| so legs always pedal forward regardless
    // of travel direction. The rig's scaleX handles visual facing.
    this._legPhase += Math.abs(velocity) * dt * PEDAL_RATE;

    // ── Wheels ────────────────────────────────────────────────────────────
    const wheelDelta = Math.abs(velocity) * dt * WHEEL_RATE;
    frontWheel.rotation += wheelDelta;
    backWheel.rotation  += wheelDelta;

    // ── Legs ──────────────────────────────────────────────────────────────
    const lf = this._legPhase;
    const lb = this._legPhase + Math.PI;

    upperLegFront.rotation = LEG_SWING  * Math.sin(lf);
    lowerLegFront.rotation = Math.max(0, Math.sin(lf + KNEE_OFFSET)) * KNEE_BEND;
    upperLegBack.rotation  = LEG_SWING  * Math.sin(lb);
    lowerLegBack.rotation  = Math.max(0, Math.sin(lb + KNEE_OFFSET)) * KNEE_BEND;

    // ── Arms ──────────────────────────────────────────────────────────────
    upperArmFront.rotation = ARM_SWING * Math.sin(lb);
    upperArmBack.rotation  = ARM_SWING * Math.sin(lf);

    // ── Body bob ──────────────────────────────────────────────────────────
    const bobT = Math.min(absSpeed / 800, 1);
    torso.y = Math.sin(lf * 2) * BOB_AMP * bobT;

    // ── Head counter-nod ──────────────────────────────────────────────────
    head.rotation = -torso.rotation * 0.4;

    // ── Lean — BUG FIX 1: time-normalised easing ──────────────────────────
    // Old: += (target - current) * 0.07  ← frame-rate dependent (jittery)
    // New: use exponential smoothing with dt so convergence rate is identical
    //      at 30fps and 120fps.
    const accel = dt > 0.001 ? (velocity - this._prevVel) / dt : 0;
    const targetLean = clamp(accel / LEAN_SCALE, -LEAN_MAX, LEAN_MAX);
    // 1 - (1 - α)^(dt*60) normalises the per-frame factor to real time
    const leanSmoothing = 1 - Math.pow(1 - LEAN_ALPHA, dt * 60);
    this._currentLean += (targetLean - this._currentLean) * leanSmoothing;
    root.rotation = this._currentLean * dir; // lean into travel direction

    // Suppress unused variable warning from old wasPosOrZero reference
    void wasPosOrZero;
    void dir;

    this._prevVel = velocity;
  }

  // ── Private — direction flip ─────────────────────────────────────────────

  /**
   * Play a squish-pivot-restore animation when the rider reverses direction.
   *
   * Timeline:
   *   0s       scaleX squishes to 0.1 (pivot/skid visual)
   *   flipDur  scaleX flips sign (facing changes)
   *   2×flipDur scaleX restores to 1 (new direction)
   */
  private _playFlip(newDir: 1 | -1): void {
    if (this._flipping) return;
    this._flipping = true;

    const root = this.parts.root;
    const half = FLIP_DURATION / 2;

    // Phase 1: squish to flat
    gsap.to(root.scale, {
      x: 0.1,
      duration: half,
      ease: "power2.in",
      onComplete: () => {
        // Apply the facing flip at the moment of zero width
        this._facingRight = newDir === 1;
        root.scale.x = 0.1 * newDir;

        // Phase 2: restore to full width in new direction
        gsap.to(root.scale, {
          x: newDir,
          duration: half,
          ease: "power2.out",
          onComplete: () => {
            this._flipping = false;
          },
        });
      },
    });
  }

  // ── Build ────────────────────────────────────────────────────────────────

  private _buildRig(): RigParts {
    const root = new PIXI.Container();

    // ── Back wheel ───────────────────────────────────────────────────────
    const backWheel = new PIXI.Graphics();
    drawWheel(backWheel);
    backWheel.position.set(-28, 0);

    // ── Front wheel ──────────────────────────────────────────────────────
    const frontWheel = new PIXI.Graphics();
    drawWheel(frontWheel);
    frontWheel.position.set(28, 0);

    // ── Frame ────────────────────────────────────────────────────────────
    const frameColor = col("frame", DARK);
    const frame = new PIXI.Graphics();
    frame.circle(0, -12, 6).fill(frameColor);
    frame.moveTo(0, -12).lineTo(-28, 0).stroke({ color: frameColor, width: 3 });
    frame.moveTo(0, -12).lineTo(22, -32).stroke({ color: frameColor, width: 3 });
    frame.moveTo(0, -12).lineTo(-6, -36).stroke({ color: frameColor, width: 3 });
    frame.moveTo(-6, -36).lineTo(22, -32).stroke({ color: frameColor, width: 3 });
    frame.moveTo(22, -32).lineTo(24, -14).stroke({ color: frameColor, width: 4 });
    frame.moveTo(24, -14).lineTo(28, 0).stroke({ color: frameColor, width: 3 });
    frame.moveTo(22, -32).lineTo(26, -42).stroke({ color: frameColor, width: 3 });
    frame.moveTo(26, -42).lineTo(30, -38).stroke({ color: frameColor, width: 3 });
    frame.moveTo(-16, -38).lineTo(-2, -38).stroke({ color: frameColor, width: 5 });

    // ── Back leg (rendered behind frame) ─────────────────────────────────
    const upperLegBack = new PIXI.Container();
    const ulbG = new PIXI.Graphics();
    drawLimb(ulbG, UPPER_LEG_LEN, 7, col("upperLegB", MID));
    upperLegBack.addChild(ulbG);
    upperLegBack.position.set(-3, -28);

    const lowerLegBack = new PIXI.Container();
    const llbG = new PIXI.Graphics();
    drawLimb(llbG, LOWER_LEG_LEN, 6, col("lowerLegB", MID), 5);
    lowerLegBack.addChild(llbG);
    lowerLegBack.position.set(0, UPPER_LEG_LEN);
    upperLegBack.addChild(lowerLegBack);

    // ── Front leg (rendered in front of frame) ────────────────────────────
    const upperLegFront = new PIXI.Container();
    const ulfG = new PIXI.Graphics();
    drawLimb(ulfG, UPPER_LEG_LEN, 8, col("upperLegF", DARK));
    upperLegFront.addChild(ulfG);
    upperLegFront.position.set(-3, -28);

    const lowerLegFront = new PIXI.Container();
    const llfG = new PIXI.Graphics();
    drawLimb(llfG, LOWER_LEG_LEN, 7, col("lowerLegF", DARK), 6);
    lowerLegFront.addChild(llfG);
    lowerLegFront.position.set(0, UPPER_LEG_LEN);
    upperLegFront.addChild(lowerLegFront);

    // ── Torso ─────────────────────────────────────────────────────────────
    const torso = new PIXI.Container();
    torso.position.set(-6, -38);

    const torsoG = new PIXI.Graphics();
    torsoG.roundRect(-5, 0, 10, 22, 5).fill(col("torso", DARK));
    torsoG.circle(0, 0, 7).fill(col("torso", DARK));
    torso.addChild(torsoG);

    // ── Head ──────────────────────────────────────────────────────────────
    const head = new PIXI.Graphics();
    head.circle(0, 0, 10).fill(col("head", DARK));
    head.arc(0, 0, 10, Math.PI + 0.3, Math.PI * 2 - 0.3)
      .stroke({ color: LIGHT, width: 2 });
    head.moveTo(-12, 2).lineTo(12, 2).stroke({ color: MID, width: 3 });
    head.position.set(0, -12);
    torso.addChild(head);

    // ── Back arm ──────────────────────────────────────────────────────────
    const upperArmBack = new PIXI.Container();
    const uabG = new PIXI.Graphics();
    drawLimb(uabG, UPPER_ARM_LEN, 6, col("upperArmB", MID));
    upperArmBack.addChild(uabG);
    upperArmBack.rotation = 0.9;
    upperArmBack.position.set(2, 2);

    const lowerArmBack = new PIXI.Container();
    const labG = new PIXI.Graphics();
    drawLimb(labG, LOWER_ARM_LEN, 5, col("lowerArmB", MID));
    lowerArmBack.addChild(labG);
    lowerArmBack.position.set(0, UPPER_ARM_LEN);
    lowerArmBack.rotation = 0.3;
    upperArmBack.addChild(lowerArmBack);
    torso.addChild(upperArmBack);

    // ── Front arm ─────────────────────────────────────────────────────────
    const upperArmFront = new PIXI.Container();
    const uafG = new PIXI.Graphics();
    drawLimb(uafG, UPPER_ARM_LEN, 7, col("upperArmF", DARK));
    upperArmFront.addChild(uafG);
    upperArmFront.rotation = 0.9;
    upperArmFront.position.set(2, 2);

    const lowerArmFront = new PIXI.Container();
    const lafG = new PIXI.Graphics();
    drawLimb(lafG, LOWER_ARM_LEN, 6, col("lowerArmF", DARK));
    lowerArmFront.addChild(lafG);
    lowerArmFront.position.set(0, UPPER_ARM_LEN);
    lowerArmFront.rotation = 0.3;
    upperArmFront.addChild(lowerArmFront);
    torso.addChild(upperArmFront);

    // ── Assemble — strict back-to-front depth order ───────────────────────
    // upperLegBack  → behind everything
    // backWheel     → behind frame
    // frame         → structural mid
    // frontWheel    → in front of frame
    // upperLegFront → in front of frame, behind torso
    // torso         → topmost
    root.addChild(upperLegBack);
    root.addChild(backWheel);
    root.addChild(frame);
    root.addChild(frontWheel);
    root.addChild(upperLegFront);
    root.addChild(torso);

    return {
      root, torso, head,
      upperArmFront, lowerArmFront,
      upperArmBack,  lowerArmBack,
      upperLegFront, lowerLegFront,
      upperLegBack,  lowerLegBack,
      frontWheel, backWheel,
    };
  }
}
