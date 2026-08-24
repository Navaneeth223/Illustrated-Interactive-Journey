/**
 * SunMoonActor — Stage C
 *
 * A sun/moon sprite that moves along a simple arc based on the current
 * segment's timeOfDay declaration.  Crossfades sun ↔ moon as timeOfDay
 * transitions between segments.  Stars fade in during "night".
 *
 * The arc is a semicircle: progress 0 = horizon-left, 1 = horizon-right,
 * with the peak at progress 0.5 (zenith).
 */

import * as PIXI from "pixi.js";
import { gsap } from "gsap";

// ---------------------------------------------------------------------------
// Arc position mapping
// ---------------------------------------------------------------------------

const TIME_ARC: Record<string, number> = {
  dawn:  0.12,
  day:   0.50,
  dusk:  0.88,
  night: 0.50, // moon at zenith during night
};

const ARC_RADIUS_FACTOR = 0.42; // fraction of screen width
const ARC_CENTER_Y_FACTOR = 0.75; // fraction of screen height (below horizon)

// ---------------------------------------------------------------------------
// Star field
// ---------------------------------------------------------------------------

interface Star { x: number; y: number; r: number; alpha: number; }

function buildStarField(count: number, w: number, h: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x:     Math.random() * w,
      y:     Math.random() * h * 0.55, // upper 55% of screen
      r:     0.5 + Math.random() * 1.5,
      alpha: 0.4 + Math.random() * 0.6,
    });
  }
  return stars;
}

// ---------------------------------------------------------------------------
// SunMoonActor
// ---------------------------------------------------------------------------

export class SunMoonActor {
  private readonly _container: PIXI.Container;
  private readonly _sunGraphics:  PIXI.Graphics;
  private readonly _moonGraphics: PIXI.Graphics;
  private readonly _starGraphics: PIXI.Graphics;
  private readonly _stars: Star[];

  private _currentTimeOfDay: string = "day";
  private _arcProgress: number      = TIME_ARC["day"];
  private _nightAlpha: number       = 0;   // 0 = day, 1 = night stars visible
  private _moonAlpha: number        = 0;

  // Runtime dimensions
  private _screenW: number;
  private _screenH: number;

  constructor(app: PIXI.Application) {
    this._screenW = app.screen.width;
    this._screenH = app.screen.height;

    this._container    = new PIXI.Container();
    this._starGraphics = new PIXI.Graphics();
    this._sunGraphics  = new PIXI.Graphics();
    this._moonGraphics = new PIXI.Graphics();

    this._stars = buildStarField(120, this._screenW, this._screenH);

    this._drawSun();
    this._drawMoon();
    this._drawStars();

    this._container.addChild(this._starGraphics);
    this._container.addChild(this._sunGraphics);
    this._container.addChild(this._moonGraphics);

    this._moonGraphics.alpha = 0;
    this._starGraphics.alpha = 0;

    this._updatePosition();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** The PIXI container to add to the stage (behind all parallax layers). */
  get container(): PIXI.Container {
    return this._container;
  }

  /**
   * Transition to a new time-of-day.  Call when the rider enters a new segment.
   * @param timeOfDay "dawn" | "day" | "dusk" | "night"
   */
  transitionTo(timeOfDay: string): void {
    if (timeOfDay === this._currentTimeOfDay) return;
    this._currentTimeOfDay = timeOfDay;

    const target = TIME_ARC[timeOfDay] ?? 0.5;
    const isNight = timeOfDay === "night";

    gsap.to(this, {
      _arcProgress: target,
      _nightAlpha:  isNight ? 1 : 0,
      _moonAlpha:   (timeOfDay === "night" || timeOfDay === "dusk") ? 1 : 0,
      duration: 2.5,
      ease: "power1.inOut",
      onUpdate: () => this._updatePosition(),
    });
  }

  /** Called each frame to apply eased values to graphics alphas. */
  update(): void {
    this._moonGraphics.alpha = this._moonAlpha;
    this._sunGraphics.alpha  = 1 - this._moonAlpha * 0.9;
    this._starGraphics.alpha = this._nightAlpha;
  }

  handleResize(w: number, h: number): void {
    this._screenW = w;
    this._screenH = h;
    this._updatePosition();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _updatePosition(): void {
    const cx = this._screenW * 0.5;
    const cy = this._screenH * ARC_CENTER_Y_FACTOR;
    const r  = this._screenW * ARC_RADIUS_FACTOR;
    const a  = this._arcProgress * Math.PI; // 0…π

    const x = cx + Math.cos(Math.PI - a) * r;
    const y = cy - Math.sin(a) * r * 0.55; // slight flatten

    this._sunGraphics.position.set(x, y);
    this._moonGraphics.position.set(x + 4, y - 4);
  }

  private _drawSun(): void {
    const g = this._sunGraphics;
    g.circle(0, 0, 18).fill(0xe8dcc8);
    g.circle(0, 0, 22).stroke({ color: 0xd8c8a0, width: 2, alpha: 0.5 });
    // Rays
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.moveTo(Math.cos(a) * 24, Math.sin(a) * 24)
        .lineTo(Math.cos(a) * 32, Math.sin(a) * 32)
        .stroke({ color: 0xd8c8a0, width: 2, alpha: 0.6 });
    }
  }

  private _drawMoon(): void {
    const g = this._moonGraphics;
    g.circle(0, 0, 15).fill(0xd8d0c0);
    // Crescent shadow
    g.circle(6, -3, 12).fill(0x1a1814);
  }

  private _drawStars(): void {
    const g = this._starGraphics;
    for (const s of this._stars) {
      g.circle(s.x, s.y, s.r).fill({ color: 0xf0ece4, alpha: s.alpha });
    }
  }
}
