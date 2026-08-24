/**
 * WindSystem — Stage C
 *
 * One shared windIntensity value (0–1) that all swaying objects read from.
 * GSAP eases it toward random targets over time.  Any tree, grass, or particle
 * that wants to sway imports this module and reads windIntensity.
 */

import { gsap } from "gsap";

export class WindSystem {
  private readonly _state = { intensity: 0.3 };
  private _tween: gsap.core.Tween | null = null;

  constructor() {
    this._scheduleNext();
  }

  /** Current wind intensity 0 (calm) … 1 (strong gust). */
  get intensity(): number {
    return this._state.intensity;
  }

  destroy(): void {
    this._tween?.kill();
  }

  private _scheduleNext(): void {
    const target   = 0.1 + Math.random() * 0.9;
    const duration = 3 + Math.random() * 5;

    this._tween = gsap.to(this._state, {
      intensity: target,
      duration,
      ease: "sine.inOut",
      onComplete: () => this._scheduleNext(),
    });
  }
}
