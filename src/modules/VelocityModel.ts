import { gsap } from "gsap";

/**
 * Configuration for a VelocityModel instance.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 1.3
 */
export interface VelocityModelConfig {
  /** Maximum world velocity in pixels per second (at 1× scale). */
  maxVelocity: number;
  /** Seconds for the 0 → maxVelocity GSAP acceleration tween. */
  accelerationDuration: number;
  /** Seconds for the maxVelocity → 0 GSAP deceleration tween. */
  decelerationDuration: number;
  /**
   * World position (px) at which forward movement is clamped.
   * Corresponds to the terminal edge of the final segment.
   */
  terminalEdge: number;
}

type PositionUpdateHandler = (pos: number, vel: number) => void;

/**
 * VelocityModel — GSAP-driven acceleration, coasting, and position integration.
 *
 * GSAP tweens the `_state.velocity` field directly; `tick()` integrates
 * `worldPosition` from that velocity value each frame.  No other code mutates
 * `_state.velocity` directly.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 1.3
 */
export class VelocityModel {
  private readonly _config: VelocityModelConfig;

  /**
   * Mutable state object whose `velocity` field is tweened directly by GSAP.
   * Exposed as a plain object so the GSAP tween target is stable.
   */
  readonly _state: { velocity: number } = { velocity: 0 };

  private _worldPosition: number = 0;
  private _isHolding: boolean = false;
  private _activeTween: gsap.core.Tween | null = null;

  private readonly _positionUpdateListeners: Set<PositionUpdateHandler> = new Set();

  constructor(config: VelocityModelConfig) {
    this._config = config;
  }

  // ---------------------------------------------------------------------------
  // Public getters
  // ---------------------------------------------------------------------------

  /** Current world velocity in px/s (mirrors `_state.velocity`). */
  get velocity(): number {
    return this._state.velocity;
  }

  /** Monotonically-increasing world position in px (clamped at terminalEdge). */
  get worldPosition(): number {
    return this._worldPosition;
  }

  /** True while a hold input is active (i.e., after `startHold()` and before the next `releaseHold()`). */
  get isHolding(): boolean {
    return this._isHolding;
  }

  // ---------------------------------------------------------------------------
  // Hold control
  // ---------------------------------------------------------------------------

  /**
   * Begin accelerating toward `maxVelocity` (forward).
   * Uses GSAP with `overwrite: true` to cancel any in-flight tween.
   *
   * Requirement 4.1
   */
  startHold(): void {
    this._isHolding = true;
    this._activeTween = gsap.to(this._state, {
      velocity: this._config.maxVelocity,
      duration: this._config.accelerationDuration,
      ease: "power2.inOut",
      overwrite: true,
    });
  }

  /**
   * Begin accelerating toward `-maxVelocity` (backward).
   */
  startHoldBack(): void {
    this._isHolding = true;
    this._activeTween = gsap.to(this._state, {
      velocity: -this._config.maxVelocity,
      duration: this._config.accelerationDuration,
      ease: "power2.inOut",
      overwrite: true,
    });
  }

  /**
   * Begin decelerating toward zero (coasting).
   * Uses GSAP with `overwrite: true` to cancel any in-flight acceleration.
   *
   * Requirements 4.2, 4.3
   */
  releaseHold(): void {
    this._isHolding = false;
    this._activeTween = gsap.to(this._state, {
      velocity: 0,
      duration: this._config.decelerationDuration,
      ease: "power2.inOut",
      overwrite: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Integrate position by one frame.
   *
   * Called once per rAF tick with the elapsed time in **seconds**.
   *
   * - Advances `worldPosition` by `velocity * dt`.
   * - Clamps `worldPosition` to `terminalEdge`; if clamped, sets velocity to 0
   *   and kills any active GSAP tween so the rider truly stops.
   * - Emits `positionUpdate` with the resulting position and velocity.
   *
   * Requirements: 4.1, 4.2, 4.3, 4.4, 1.3
   */
  tick(dt: number): void {
    this._worldPosition += this._state.velocity * dt;

    // Clamp at the left boundary (can't go before start)
    if (this._worldPosition <= 0) {
      this._worldPosition = 0;
      if (this._state.velocity < 0) {
        if (this._activeTween) { this._activeTween.kill(); this._activeTween = null; }
        this._state.velocity = 0;
      }
    }

    // Clamp at the terminal edge (Requirement 1.3)
    if (this._worldPosition >= this._config.terminalEdge) {
      this._worldPosition = this._config.terminalEdge;

      // Kill velocity and any in-flight tween
      if (this._activeTween) {
        this._activeTween.kill();
        this._activeTween = null;
      }
      this._state.velocity = 0;
    }

    this._emitPositionUpdate();
  }

  // ---------------------------------------------------------------------------
  // Event API
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to `positionUpdate` events.
   * The handler receives the current world position and velocity on each tick.
   */
  on(event: "positionUpdate", handler: PositionUpdateHandler): void {
    if (event === "positionUpdate") {
      this._positionUpdateListeners.add(handler);
    }
  }

  /**
   * Unsubscribe a previously registered `positionUpdate` handler.
   */
  off(event: "positionUpdate", handler: PositionUpdateHandler): void {
    if (event === "positionUpdate") {
      this._positionUpdateListeners.delete(handler);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _emitPositionUpdate(): void {
    if (this._positionUpdateListeners.size === 0) return;
    const pos = this._worldPosition;
    const vel = this._state.velocity;
    this._positionUpdateListeners.forEach((fn) => fn(pos, vel));
  }
}
