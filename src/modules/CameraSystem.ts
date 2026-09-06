/**
 * CameraSystem — Phase 4 Stage A
 *
 * Turns the implicit "character fixed, world scrolls" camera into an explicit
 * system with three capabilities:
 *
 * 1. Per-segment camera profile ("default" | "wide" | "tight")
 *    Applied by calling applyProfile() when a segment changes.
 *    wide  → more world visible, character smaller/lower (reveal moments)
 *    tight → closer framing, claustrophobic (canyon, breakdown)
 *
 * 2. Push-in on dramatic beats
 *    Brief scale tween on the cameraRoot container.
 *
 * 3. Shake (for the train breakdown)
 *    Short, decaying position jitter via GSAP.
 *
 * 4. Global timeScale
 *    A single scalar that JourneyController multiplies into `dt` before
 *    passing it to VelocityModel and PixiRenderer. Slowing timeScale slows
 *    both physics and animation together.
 *
 * The "camera" is a PIXI.Container (cameraRoot) that wraps the entire scene.
 * The stage hierarchy becomes:
 *   app.stage
 *     └─ cameraRoot   ← CameraSystem owns this
 *          └─ [sky, bg, mg, nmg, fg, cyclist, occlusion, dust, grain]
 *
 * PixiRenderer receives the cameraRoot as its parent container instead of
 * app.stage directly. Camera transforms (scale, position) applied to
 * cameraRoot affect the whole scene uniformly.
 */

import * as PIXI from "pixi.js";
import { gsap } from "gsap";

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

interface CameraProfile {
  scaleX: number;
  scaleY: number;
  /** Fractional Y offset applied to cameraRoot (positive = pan down) */
  yOffset: number;
}

const PROFILES: Record<string, CameraProfile> = {
  default: { scaleX: 1.00, scaleY: 1.00, yOffset: 0.00 },
  wide:    { scaleX: 0.88, scaleY: 0.88, yOffset: 0.04 },  // zoom out, pan down
  tight:   { scaleX: 1.14, scaleY: 1.14, yOffset: -0.02 }, // zoom in, pan up
};

// ---------------------------------------------------------------------------
// CameraSystem
// ---------------------------------------------------------------------------

export class CameraSystem {
  /** Wrap all scene children inside this container. */
  readonly cameraRoot: PIXI.Container;

  /** Global time multiplier — 1 = normal, 0 = frozen. */
  private _timeScale: number = 1.0;

  private _screenH: number;
  private _currentProfile: string = "default";

  // Active GSAP tweens — kept so they can be killed on new transitions.
  private _profileTween: gsap.core.Tween | null = null;
  private _shakeTween:   gsap.core.Tween | null = null;
  private _timeScaleTween: gsap.core.Tween | null = null;

  constructor(app: PIXI.Application) {
    this._screenH = app.screen.height;
    this.cameraRoot = new PIXI.Container();
    app.stage.addChild(this.cameraRoot);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Current global time scale (0–1+). Multiply into dt in the rAF loop. */
  get timeScale(): number {
    return this._timeScale;
  }

  /**
   * Transition the camera to a named profile over `duration` seconds.
   * @param profile "default" | "wide" | "tight"
   * @param duration Tween duration in seconds (default 1.0)
   */
  applyProfile(profile: string, duration = 1.0): void {
    if (profile === this._currentProfile) return;
    this._currentProfile = profile;

    const p = PROFILES[profile] ?? PROFILES["default"];
    this._profileTween?.kill();

    this._profileTween = gsap.to(this.cameraRoot.scale, {
      x: p.scaleX,
      y: p.scaleY,
      duration,
      ease: "power2.inOut",
    });

    // Also shift cameraRoot.y proportionally to keep the ground in frame
    gsap.to(this.cameraRoot, {
      y: this._screenH * p.yOffset,
      duration,
      ease: "power2.inOut",
    });
  }

  /**
   * Brief scale push-in on a dramatic beat.
   * e.g. when the player crosses a specific world-position trigger.
   */
  pushIn(scaleDelta = 1.08, duration = 1.2): void {
    const base = PROFILES[this._currentProfile]?.scaleX ?? 1.0;
    gsap.to(this.cameraRoot.scale, {
      x: base * scaleDelta,
      y: base * scaleDelta,
      duration,
      yoyo: true,
      repeat: 1,
      ease: "sine.inOut",
      onComplete: () => {
        // Snap back to profile scale cleanly
        this.cameraRoot.scale.x = base;
        this.cameraRoot.scale.y = base;
      },
    });
  }

  /**
   * Short decaying position shake — for the train breakdown beat.
   * @param intensity  Max pixel displacement (default 8)
   * @param duration   Total shake duration in seconds (default 0.4)
   */
  shake(intensity = 8, duration = 0.4): void {
    this._shakeTween?.kill();

    const state = { x: 0, y: 0 };
    const steps = 12;
    const stepDur = duration / steps;
    let elapsed = 0;

    const doStep = () => {
      elapsed += stepDur;
      const decay = 1 - elapsed / duration;
      if (decay <= 0) {
        this.cameraRoot.x = 0;
        this.cameraRoot.y = (PROFILES[this._currentProfile]?.yOffset ?? 0) * this._screenH;
        return;
      }
      const tx = (Math.random() - 0.5) * 2 * intensity * decay;
      const ty = (Math.random() - 0.5) * 2 * intensity * decay;
      this._shakeTween = gsap.to(state, {
        x: tx, y: ty,
        duration: stepDur,
        ease: "none",
        onUpdate: () => {
          this.cameraRoot.x = state.x;
          this.cameraRoot.y = (PROFILES[this._currentProfile]?.yOffset ?? 0) * this._screenH + state.y;
        },
        onComplete: doStep,
      });
    };

    doStep();
  }

  /**
   * Ease global timeScale toward a target value.
   * @param target 0–1+, where 1 is normal speed
   * @param duration Tween duration in seconds
   */
  setTimeScale(target: number, duration = 2.0): void {
    this._timeScaleTween?.kill();
    const state = { v: this._timeScale };
    this._timeScaleTween = gsap.to(state, {
      v: target,
      duration,
      ease: "power2.inOut",
      onUpdate: () => { this._timeScale = state.v; },
    });
  }

  /** Handle window resize — recompute profile Y offset. */
  handleResize(_w: number, h: number): void {
    this._screenH = h;
    const p = PROFILES[this._currentProfile] ?? PROFILES["default"];
    this.cameraRoot.y = h * p.yOffset;
  }

  destroy(): void {
    this._profileTween?.kill();
    this._shakeTween?.kill();
    this._timeScaleTween?.kill();
  }
}
