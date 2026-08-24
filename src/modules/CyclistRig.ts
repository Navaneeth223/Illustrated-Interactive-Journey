/**
 * CyclistRig — a fully-jointed paper-cutout character rig.
 *
 * The rig is a container hierarchy of PIXI.Graphics shapes (placeholder art).
 * When real illustrated cutouts are available, each Graphics node is replaced
 * by a PIXI.Sprite — the pivot positions, hierarchy, and animation logic are
 * identical; only the visual asset changes.
 *
 * Hierarchy:
 *   root (screen-fixed X, groundLineRatio Y, lean rotation)
 *     torso (pivot: hip — bob + torso lean)
 *       head (pivot: neck)
 *       upperArmFront (pivot: shoulder) → lowerArmFront (pivot: elbow)
 *       upperArmBack  (pivot: shoulder) → lowerArmBack  (pivot: elbow)
 *     upperLegFront (pivot: hip) → lowerLegFront (pivot: knee)
 *     upperLegBack  (pivot: hip) → lowerLegBack  (pivot: knee)
 *     frontWheel (pivot: own centre)
 *     backWheel  (pivot: own centre)
 *
 * All animation is driven by two values from VelocityModel:
 *   velocity  — current px/s (determines speed of all cycles)
 *   dt        — elapsed seconds since last frame
 *
 * No internal timers. Distance-driven phasing keeps cycles locked to motion.
 */

import * as PIXI from "pixi.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DARK  = 0x1a1814;
const MID   = 0x3a3530;
const LIGHT = 0x7a7570;

const WHEEL_RADIUS  = 24;
const SPOKE_COUNT   = 8;
const UPPER_LEG_LEN = 24;
const LOWER_LEG_LEN = 22;
const UPPER_ARM_LEN = 16;
const LOWER_ARM_LEN = 14;

// Tuning knobs
const PEDAL_RATE    = 0.0042; // legPhase advance per pixel travelled
const WHEEL_RATE    = 0.031;  // wheel rotation per pixel travelled
const LEG_SWING     = 0.75;   // upper-leg rotation amplitude (radians)
const KNEE_BEND     = 0.95;   // lower-leg max bend
const KNEE_OFFSET   = 0.85;   // phase offset for knee vs hip
const ARM_SWING     = 0.22;   // upper-arm oscillation amplitude
const LEAN_SCALE    = 9000;   // acceleration → lean divisor
const LEAN_MAX      = 0.13;   // radians clamp
const LEAN_EASE     = 0.07;   // lean easing factor per frame
const BOB_AMP       = 3.5;    // max vertical bob in pixels

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function drawWheel(g: PIXI.Graphics): void {
  g.circle(0, 0, WHEEL_RADIUS).stroke({ color: DARK, width: 4 });
  g.circle(0, 0, 5).fill(DARK);
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const a = (i / SPOKE_COUNT) * Math.PI * 2;
    g.moveTo(0, 0)
      .lineTo(Math.cos(a) * (WHEEL_RADIUS - 3), Math.sin(a) * (WHEEL_RADIUS - 3))
      .stroke({ color: MID, width: 1.5 });
  }
}

function drawLimb(
  g: PIXI.Graphics,
  length: number,
  thickness: number,
  color: number,
  endDot: number = 0,
): void {
  g.roundRect(-thickness / 2, 0, thickness, length, thickness / 2).fill(color);
  if (endDot > 0) {
    g.circle(0, length, endDot).fill(color);
  }
}

// ---------------------------------------------------------------------------
// Rig parts record
// ---------------------------------------------------------------------------

export interface RigParts {
  root:           PIXI.Container;
  torso:          PIXI.Container;
  head:           PIXI.Graphics;
  // Arms
  upperArmFront:  PIXI.Container;
  lowerArmFront:  PIXI.Container;
  upperArmBack:   PIXI.Container;
  lowerArmBack:   PIXI.Container;
  // Legs
  upperLegFront:  PIXI.Container;
  lowerLegFront:  PIXI.Container;
  upperLegBack:   PIXI.Container;
  lowerLegBack:   PIXI.Container;
  // Wheels
  frontWheel:     PIXI.Graphics;
  backWheel:      PIXI.Graphics;
}

// ---------------------------------------------------------------------------
// CyclistRig
// ---------------------------------------------------------------------------

export class CyclistRig {
  readonly parts: RigParts;

  // Animation state
  private _legPhase:    number = 0;
  private _prevVel:     number = 0;
  private _currentLean: number = 0;

  constructor() {
    this.parts = this._buildRig();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Advance the rig by one frame.
   * @param velocity  Current world velocity in px/s (signed).
   * @param dt        Elapsed seconds since last frame.
   */
  update(velocity: number, dt: number): void {
    const { root, torso, head, upperLegFront, lowerLegFront, upperLegBack,
            lowerLegBack, upperArmFront, upperArmBack, frontWheel, backWheel } = this.parts;

    const absSpeed = Math.abs(velocity);
    const dir      = velocity >= 0 ? 1 : -1;

    // ── Phase accumulation (distance-driven) ──────────────────────────────
    this._legPhase += velocity * dt * PEDAL_RATE;

    // ── Wheels ────────────────────────────────────────────────────────────
    const wheelDelta = velocity * dt * WHEEL_RATE;
    frontWheel.rotation += wheelDelta;
    backWheel.rotation  += wheelDelta;

    // ── Legs ──────────────────────────────────────────────────────────────
    const lf = this._legPhase;
    const lb = this._legPhase + Math.PI;

    upperLegFront.rotation = LEG_SWING * Math.sin(lf) * dir;
    lowerLegFront.rotation = Math.max(0, Math.sin(lf + KNEE_OFFSET)) * KNEE_BEND;

    upperLegBack.rotation  = LEG_SWING * Math.sin(lb) * dir;
    lowerLegBack.rotation  = Math.max(0, Math.sin(lb + KNEE_OFFSET)) * KNEE_BEND;

    // ── Arms (subtle counter-swing) ───────────────────────────────────────
    upperArmFront.rotation = ARM_SWING * Math.sin(lb);
    upperArmBack.rotation  = ARM_SWING * Math.sin(lf);

    // ── Body bob ──────────────────────────────────────────────────────────
    const bobT = Math.min(absSpeed / 800, 1);
    torso.y = Math.sin(lf * 2) * BOB_AMP * bobT;

    // ── Head counter-nod (keeps head more stable than torso) ─────────────
    head.rotation = -torso.rotation * 0.4;

    // ── Lean (acceleration-driven, eased) ─────────────────────────────────
    const accel      = dt > 0.001 ? (velocity - this._prevVel) / dt : 0;
    const targetLean = clamp(accel / LEAN_SCALE, -LEAN_MAX, LEAN_MAX);
    this._currentLean += (targetLean - this._currentLean) * LEAN_EASE;
    root.rotation = this._currentLean;

    this._prevVel = velocity;
  }

  // ── Build ──────────────────────────────────────────────────────────────

  private _buildRig(): RigParts {
    const root = new PIXI.Container();

    // ── Back wheel ────────────────────────────────────────────────────────
    const backWheel = new PIXI.Graphics();
    drawWheel(backWheel);
    backWheel.position.set(-28, 0);

    // ── Front wheel ───────────────────────────────────────────────────────
    const frontWheel = new PIXI.Graphics();
    drawWheel(frontWheel);
    frontWheel.position.set(28, 0);

    // ── Bike frame ────────────────────────────────────────────────────────
    const frame = new PIXI.Graphics();
    // Bottom bracket
    frame.circle(0, -12, 6).fill(DARK);
    // Chain stays (rear)
    frame.moveTo(0, -12).lineTo(-28, 0).stroke({ color: DARK, width: 3 });
    // Down tube
    frame.moveTo(0, -12).lineTo(22, -32).stroke({ color: DARK, width: 3 });
    // Seat tube
    frame.moveTo(0, -12).lineTo(-6, -36).stroke({ color: DARK, width: 3 });
    // Top tube
    frame.moveTo(-6, -36).lineTo(22, -32).stroke({ color: DARK, width: 3 });
    // Head tube
    frame.moveTo(22, -32).lineTo(24, -14).stroke({ color: DARK, width: 4 });
    // Fork
    frame.moveTo(24, -14).lineTo(28, 0).stroke({ color: DARK, width: 3 });
    // Handlebars
    frame.moveTo(22, -32).lineTo(26, -42).stroke({ color: DARK, width: 3 });
    frame.moveTo(26, -42).lineTo(30, -38).stroke({ color: DARK, width: 3 });
    // Saddle
    frame.moveTo(-16, -38).lineTo(-2, -38).stroke({ color: DARK, width: 5 });

    // ── Back leg (behind frame — rendered first) ───────────────────────────
    const upperLegBack = new PIXI.Container();
    const ulbG = new PIXI.Graphics();
    drawLimb(ulbG, UPPER_LEG_LEN, 7, MID);
    upperLegBack.addChild(ulbG);
    upperLegBack.pivot.set(0, 0);
    upperLegBack.position.set(-3, -28);

    const lowerLegBack = new PIXI.Container();
    const llbG = new PIXI.Graphics();
    drawLimb(llbG, LOWER_LEG_LEN, 6, MID, 5);
    lowerLegBack.addChild(llbG);
    lowerLegBack.position.set(0, UPPER_LEG_LEN);
    upperLegBack.addChild(lowerLegBack);

    // ── Front leg (in front of frame) ─────────────────────────────────────
    const upperLegFront = new PIXI.Container();
    const ulfG = new PIXI.Graphics();
    drawLimb(ulfG, UPPER_LEG_LEN, 8, DARK);
    upperLegFront.addChild(ulfG);
    upperLegFront.position.set(-3, -28);

    const lowerLegFront = new PIXI.Container();
    const llfG = new PIXI.Graphics();
    drawLimb(llfG, LOWER_LEG_LEN, 7, DARK, 6);
    lowerLegFront.addChild(llfG);
    lowerLegFront.position.set(0, UPPER_LEG_LEN);
    upperLegFront.addChild(lowerLegFront);

    // ── Torso (pivot at hip — ~seat level) ────────────────────────────────
    const torso = new PIXI.Container();
    torso.position.set(-6, -38);

    const torsoG = new PIXI.Graphics();
    // Body tube
    torsoG.roundRect(-5, 0, 10, 22, 5).fill(DARK);
    // Chest
    torsoG.circle(0, 0, 7).fill(DARK);
    torso.addChild(torsoG);

    // ── Head ──────────────────────────────────────────────────────────────
    const head = new PIXI.Graphics();
    head.circle(0, 0, 10).fill(DARK);
    // Face highlight (graphite paper look)
    head.arc(0, 0, 10, Math.PI + 0.3, Math.PI * 2 - 0.3)
      .stroke({ color: LIGHT, width: 2 });
    // Helmet brim
    head.moveTo(-12, 2).lineTo(12, 2).stroke({ color: MID, width: 3 });
    head.position.set(0, -12);  // neck offset above torso top
    torso.addChild(head);

    // ── Back arm (behind torso) ────────────────────────────────────────────
    const upperArmBack = new PIXI.Container();
    const uabG = new PIXI.Graphics();
    drawLimb(uabG, UPPER_ARM_LEN, 6, MID);
    upperArmBack.addChild(uabG);
    upperArmBack.rotation = 0.9; // resting forward reach
    upperArmBack.position.set(2, 2);

    const lowerArmBack = new PIXI.Container();
    const labG = new PIXI.Graphics();
    drawLimb(labG, LOWER_ARM_LEN, 5, MID);
    lowerArmBack.addChild(labG);
    lowerArmBack.position.set(0, UPPER_ARM_LEN);
    lowerArmBack.rotation = 0.3;
    upperArmBack.addChild(lowerArmBack);
    torso.addChild(upperArmBack);

    // ── Front arm (in front of torso) ─────────────────────────────────────
    const upperArmFront = new PIXI.Container();
    const uafG = new PIXI.Graphics();
    drawLimb(uafG, UPPER_ARM_LEN, 7, DARK);
    upperArmFront.addChild(uafG);
    upperArmFront.rotation = 0.9;
    upperArmFront.position.set(2, 2);

    const lowerArmFront = new PIXI.Container();
    const lafG = new PIXI.Graphics();
    drawLimb(lafG, LOWER_ARM_LEN, 6, DARK);
    lowerArmFront.addChild(lafG);
    lowerArmFront.position.set(0, UPPER_ARM_LEN);
    lowerArmFront.rotation = 0.3;
    upperArmFront.addChild(lowerArmFront);
    torso.addChild(upperArmFront);

    // ── Assemble depth order ───────────────────────────────────────────────
    // Back elements first, front elements last
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
