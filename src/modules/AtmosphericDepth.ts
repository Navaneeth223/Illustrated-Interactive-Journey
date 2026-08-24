/**
 * AtmosphericDepth — Stage B
 *
 * Adds three depth cues on top of the existing parallax:
 *
 * 1. Per-layer atmospheric blur + desaturation filters
 *    bg: blur 1.5px, desaturate 40%
 *    mg: blur 0.4px, desaturate 15%
 *    fg: no filter (full clarity = "closest")
 *
 * 2. Secondary vertical parallax driven by pointer Y (desktop) or
 *    device tilt (mobile).  Each layer shifts on Y independently of the
 *    horizontal scroll already in PixiRenderer.
 *
 * 3. A foreground-occlusion layer — a second container added ABOVE the
 *    cyclist's z-index at specific world-position windows, so the character
 *    genuinely passes behind near-camera elements.
 *
 * This module owns its filters and the occlusion container; it does NOT own
 * the parallax containers themselves (those stay in PixiRenderer).
 */

import * as PIXI from "pixi.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A near-camera element that occludes the cyclist at a given world range. */
export interface OcclusionElement {
  /** World-space X of the element's left edge. */
  worldX: number;
  /** Width in world pixels. */
  widthPx: number;
  /** The visual — a Graphics or Sprite sitting in the occlusion container. */
  visual: PIXI.Container;
}

// ---------------------------------------------------------------------------
// AtmosphericDepth
// ---------------------------------------------------------------------------

export class AtmosphericDepth {
  // ── Filter sets ──────────────────────────────────────────────────────────

  /** Applied to bgContainer. */
  readonly bgFilters: PIXI.Filter[];
  /** Applied to mgContainer. */
  readonly mgFilters: PIXI.Filter[];

  // ── Occlusion layer ───────────────────────────────────────────────────────

  /**
   * A container added to the stage ABOVE the cyclist.
   * Elements placed here appear in front of the rider.
   */
  readonly occlusionContainer: PIXI.Container;

  // ── Vertical parallax base values ─────────────────────────────────────────

  private _bgBaseY:  number = 0;
  private _mgBaseY:  number = 0;
  private _fgBaseY:  number = 0;

  // ── Pointer / tilt state ──────────────────────────────────────────────────

  private _pointerInfluence: number = 0;   // normalised -1 … +1
  private readonly _onMouseMove: (e: MouseEvent) => void;
  private readonly _onDeviceOrientation: (e: DeviceOrientationEvent) => void;

  // ── Registered occlusion elements ─────────────────────────────────────────

  private readonly _elements: OcclusionElement[] = [];

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(app: PIXI.Application) {
    // ── Atmospheric filters ────────────────────────────────────────────────

    // Background: blurred + strongly desaturated → reads as very distant
    const bgBlur = new PIXI.BlurFilter({ strength: 1.5, quality: 3 });
    const bgDesaturate = new PIXI.ColorMatrixFilter();
    bgDesaturate.saturate(-0.4, false);
    this.bgFilters = [bgBlur, bgDesaturate];

    // Midground: slight blur + mild desaturation → mid-distance
    const mgBlur = new PIXI.BlurFilter({ strength: 0.5, quality: 2 });
    const mgDesaturate = new PIXI.ColorMatrixFilter();
    mgDesaturate.saturate(-0.15, false);
    this.mgFilters = [mgBlur, mgDesaturate];

    // Foreground: no filters — maximum clarity = nearest plane

    // ── Occlusion container ────────────────────────────────────────────────
    this.occlusionContainer = new PIXI.Container();
    // Caller adds this to stage ABOVE the cyclist container.

    // ── Pointer/tilt input ─────────────────────────────────────────────────
    const screenH = app.screen.height;

    this._onMouseMove = (e: MouseEvent) => {
      // Normalise to -1 (top) … +1 (bottom)
      this._pointerInfluence = (e.clientY / screenH - 0.5) * 2;
    };

    this._onDeviceOrientation = (e: DeviceOrientationEvent) => {
      // beta is the front-back tilt; range is roughly -90…+90
      if (e.beta !== null) {
        this._pointerInfluence = clamp(e.beta / 45, -1, 1);
      }
    };

    window.addEventListener("mousemove", this._onMouseMove, { passive: true });
    window.addEventListener("deviceorientation", this._onDeviceOrientation, { passive: true });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Apply the per-layer filters to the supplied containers.
   * Call once after PixiRenderer creates the containers.
   */
  applyFilters(
    bgContainer: PIXI.Container,
    mgContainer: PIXI.Container,
  ): void {
    bgContainer.filters = this.bgFilters;
    mgContainer.filters = this.mgFilters;
  }

  /**
   * Store the base Y values for each layer so vertical parallax deltas are
   * added on top. Call once after PixiRenderer positions the stage.
   */
  setBaseYValues(bg: number, mg: number, fg: number): void {
    this._bgBaseY = bg;
    this._mgBaseY = mg;
    this._fgBaseY = fg;
  }

  /**
   * Apply vertical parallax offsets.  Call each frame from PixiRenderer.render().
   */
  applyVerticalParallax(
    bgContainer: PIXI.Container,
    mgContainer: PIXI.Container,
    fgContainer: PIXI.Container,
  ): void {
    const p = this._pointerInfluence;
    bgContainer.y = this._bgBaseY + p * 6;
    mgContainer.y = this._mgBaseY + p * 16;
    fgContainer.y = this._fgBaseY + p * 30;
  }

  /**
   * Register a near-camera element that appears above the cyclist.
   * @param worldX   World-space left edge position.
   * @param widthPx  Width in world pixels.
   * @param visual   The PIXI node to place in the occlusion container.
   */
  addOcclusionElement(worldX: number, widthPx: number, visual: PIXI.Container): void {
    this.occlusionContainer.addChild(visual);
    this._elements.push({ worldX, widthPx, visual });
  }

  /**
   * Reposition occlusion elements based on current world position.
   * The occlusion container scrolls at the foreground rate (1.0×).
   * Call each frame from PixiRenderer.render().
   */
  updateOcclusion(worldPosition: number): void {
    this.occlusionContainer.x = -worldPosition;
  }

  /** Remove all event listeners. */
  destroy(): void {
    window.removeEventListener("mousemove", this._onMouseMove);
    window.removeEventListener("deviceorientation", this._onDeviceOrientation);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
