/**
 * SoundEventBus — Phase 4 Stage C
 *
 * Event-triggered one-shot sounds on top of AudioController's ambient loops.
 *
 * One-shots fired from this bus:
 *   "door-creak"       — doorCycle NPC reaches its door position
 *   "splash"           — rider enters a terrain:"water" segment
 *   "surface-dusty"    — rider enters a terrain:"dusty" segment
 *   "breakdown"        — train breakdown trigger (camera shake beat)
 *   "reunion-swell"    — the ending sequence (Phase 4 Stage D)
 *
 * The bus is deliberately thin — it wraps Howl instances for each one-shot
 * and exposes a single `fire(event)` method.  Callers don't need to know
 * which Howl is which.
 *
 * Audio files live at:
 *   assets/audio/sfx/door-creak.mp3
 *   assets/audio/sfx/splash.mp3
 *   assets/audio/sfx/surface-dusty.mp3
 *   assets/audio/sfx/breakdown.mp3
 *   assets/audio/sfx/reunion-swell.mp3
 *
 * If an audio file is missing, the fire() call is silently a no-op.
 */

import { Howl } from "howler";

export type SoundEvent =
  | "door-creak"
  | "splash"
  | "surface-dusty"
  | "breakdown"
  | "reunion-swell";

const SFX_PATHS: Record<SoundEvent, string> = {
  "door-creak":    "assets/audio/sfx/door-creak.mp3",
  "splash":        "assets/audio/sfx/splash.mp3",
  "surface-dusty": "assets/audio/sfx/surface-dusty.mp3",
  "breakdown":     "assets/audio/sfx/breakdown.mp3",
  "reunion-swell": "assets/audio/sfx/reunion-swell.mp3",
};

export class SoundEventBus {
  private readonly _howls: Map<SoundEvent, Howl> = new Map();
  private _enabled: boolean = true;

  constructor() {
    // Pre-load all one-shot clips.  Howl with html5:false uses Web Audio API
    // for low-latency triggering consistent with the ambient AudioController.
    for (const [event, src] of Object.entries(SFX_PATHS) as [SoundEvent, string][]) {
      this._howls.set(event, new Howl({ src: [src], loop: false, volume: 0.8, html5: false }));
    }
  }

  /**
   * Fire a one-shot sound event.  No-ops when sound is globally disabled.
   */
  fire(event: SoundEvent, volumeOverride?: number): void {
    if (!this._enabled) return;
    const howl = this._howls.get(event);
    if (!howl) return;
    if (volumeOverride !== undefined) howl.volume(volumeOverride);
    howl.play();
  }

  setSoundEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  destroy(): void {
    for (const howl of this._howls.values()) howl.unload();
    this._howls.clear();
  }
}
