/**
 * DustSystem — Stage C
 *
 * A small hand-rolled particle pool (no external particle library).
 * Emits dust puffs near the rear wheel contact point when:
 *   - The current segment terrain is "dusty"
 *   - |velocity| exceeds DUST_THRESHOLD
 *
 * Pool is fixed-size (MAX_PARTICLES sprites).  Recycled sprites are reused
 * rather than created/destroyed each frame, consistent with how the rest of
 * this codebase avoids runtime allocations.
 */

import * as PIXI from "pixi.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_PARTICLES   = 20;
const DUST_THRESHOLD  = 120;   // px/s minimum velocity to emit
const EMIT_RATE       = 0.04;  // probability per frame of emitting when eligible
const PARTICLE_LIFE   = 0.7;   // seconds a puff lives
const PARTICLE_RADIUS = 5;

// ---------------------------------------------------------------------------
// Particle record
// ---------------------------------------------------------------------------

interface Particle {
  sprite:   PIXI.Graphics;
  active:   boolean;
  life:     number;   // seconds remaining
  maxLife:  number;
  vx:       number;   // world-space drift
  vy:       number;
}

// ---------------------------------------------------------------------------
// DustSystem
// ---------------------------------------------------------------------------

export class DustSystem {
  private readonly _container: PIXI.Container;
  private readonly _pool: Particle[];
  private _activeTerrain: string = "normal";

  constructor() {
    this._container = new PIXI.Container();
    this._pool = [];

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const g = new PIXI.Graphics();
      g.circle(0, 0, PARTICLE_RADIUS).fill({ color: 0x8a8480, alpha: 0.7 });
      g.visible = false;
      this._container.addChild(g);
      this._pool.push({ sprite: g, active: false, life: 0, maxLife: PARTICLE_LIFE, vx: 0, vy: 0 });
    }
  }

  /** The PIXI container — add this to the stage above foreground but below post-process. */
  get container(): PIXI.Container {
    return this._container;
  }

  /** Called when the rider enters a new segment. */
  setTerrain(terrain: string): void {
    this._activeTerrain = terrain;
  }

  /**
   * Update all active particles and optionally emit a new one.
   *
   * @param velocity        Current world velocity (signed, px/s).
   * @param dt              Elapsed seconds.
   * @param emitScreenX     Screen X of the rear-wheel contact point.
   * @param emitScreenY     Screen Y of the rear-wheel contact point.
   */
  update(velocity: number, dt: number, emitScreenX: number, emitScreenY: number): void {
    const isDusty   = this._activeTerrain === "dusty";
    const fastEnough = Math.abs(velocity) > DUST_THRESHOLD;

    // Possibly emit a new particle
    if (isDusty && fastEnough && Math.random() < EMIT_RATE) {
      this._emit(emitScreenX, emitScreenY, velocity);
    }

    // Tick all active particles
    for (const p of this._pool) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }

      const t = 1 - p.life / p.maxLife;   // 0 at birth, 1 at death
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.alpha = (1 - t) * 0.6;
      p.sprite.scale.set(1 + t * 1.5);   // expand as it fades
    }
  }

  destroy(): void {
    this._container.destroy({ children: true });
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _emit(x: number, y: number, velocity: number): void {
    const p = this._pool.find((p) => !p.active);
    if (!p) return;

    // Drift opposite to travel direction, upward
    const sign = velocity >= 0 ? -1 : 1;
    p.vx     = sign * (20 + Math.random() * 30);
    p.vy     = -(15 + Math.random() * 25);
    p.life   = PARTICLE_LIFE * (0.6 + Math.random() * 0.8);
    p.maxLife = p.life;

    p.sprite.x = x + (Math.random() - 0.5) * 8;
    p.sprite.y = y;
    p.sprite.alpha = 0.6;
    p.sprite.scale.set(1);
    p.sprite.visible = true;
    p.active = true;
  }
}
