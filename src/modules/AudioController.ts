import { gsap } from "gsap";
import { Howl } from "howler";
import type { JourneyManifest } from "@/types/journey";

/** Maximum allowed crossfade duration in milliseconds (Requirement 8.2). */
const MAX_CROSSFADE_MS = 2000;

/**
 * AudioController — Howler track pool, segment crossfades, and volume management.
 *
 * Responsibilities:
 *  - Pre-instantiates one `Howl` per segment track from the manifest at
 *    construction time, configured for `loop: true, volume: 0, autoplay: false`.
 *  - `transitionToSegment(index)` performs a crossfade from the outgoing track
 *    to the incoming track, with the fade duration clamped to ≤ 2000 ms.
 *  - `setMotionState(isMoving)` adjusts the current track's volume between
 *    `idleVolume` and `motionVolume` via a short GSAP tween (stub in this task).
 *  - `setSoundEnabled(enabled)` mutes/unmutes all tracks (stub in this task).
 *  - `isCrossfading` is true while a crossfade timer is outstanding.
 *
 * Requirements: 8.1, 8.2
 */
export class AudioController {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** The journey manifest, used to read volume scalars and crossfade duration. */
  private readonly _manifest: JourneyManifest;

  /**
   * One Howl instance per segment, keyed by segment index.
   * Populated in the constructor from `manifest.segments[i].audioTrack`.
   */
  private readonly _tracks: Howl[];

  /** The track that is currently playing (or null before the first transition). */
  private _currentTrack: Howl | null = null;

  /** Index of the currently active track (-1 before first transition). */
  private _currentIndex: number = -1;

  /**
   * Target volume applied to the currently-playing track.
   * Starts at `idleVolume`; updated by `setMotionState()`.
   */
  private _targetVolume: number;

  /** Whether ambient audio output is enabled. */
  private _soundEnabled: boolean = true;

  /**
   * Handle returned by `setTimeout` for the `outgoing.stop()` call that fires
   * at the end of a crossfade.  A non-null value means a crossfade is in
   * progress.
   */
  private _crossfadeTimer: ReturnType<typeof setTimeout> | null = null;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Pre-instantiates one `Howl` per segment audio track.
   *
   * Each track is created with:
   *  - `loop: true`   — ambient tracks loop continuously (Requirement 8.1)
   *  - `volume: 0`    — start silent; volume is set when playback begins
   *  - `autoplay: false` — tracks are started explicitly via `transitionToSegment()`
   *
   * @param manifest - The loaded journey manifest.
   */
  constructor(manifest: JourneyManifest) {
    this._manifest = manifest;
    this._targetVolume = manifest.idleVolume;

    this._tracks = manifest.segments.map(
      (segment) =>
        new Howl({
          src: [segment.audioTrack],
          loop: true,
          volume: 0,
          autoplay: false,
          html5: false, // Use Web Audio API for precise volume/fade control
        })
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Transition to the ambient track for the given segment index.
   *
   * Crossfade logic (Requirement 8.2):
   *  1. If there is no outgoing track (first call), simply play the incoming
   *     track at `_targetVolume` with no fade.
   *  2. Otherwise:
   *     a. Fade the outgoing track from its current volume to 0 over
   *        `fadeDuration` ms.
   *     b. Start the incoming track and fade it from 0 to `_targetVolume`
   *        over the same duration.
   *     c. Schedule `outgoing.stop()` after `fadeDuration` ms so it is
   *        silenced once the fade completes.
   *     d. Cancel any previously-scheduled stop timer so a rapid double
   *        transition does not leave zombie stop callbacks.
   *
   * The crossfade duration is read from `manifest.crossfadeDuration` (seconds)
   * and clamped to ≤ `MAX_CROSSFADE_MS` (2000 ms) per Requirement 8.2.
   *
   * @param segmentIndex - 0-based index into the manifest's segment array.
   */
  transitionToSegment(segmentIndex: number): void {
    if (segmentIndex === this._currentIndex) return;

    const incoming = this._tracks[segmentIndex];
    const outgoing = this._currentTrack;

    // ── First transition: no crossfade, just start playing ──────────────────
    if (!outgoing) {
      if (this._soundEnabled) {
        incoming.volume(this._targetVolume);
        incoming.play();
      }
      this._currentTrack = incoming;
      this._currentIndex = segmentIndex;
      return;
    }

    // ── Subsequent transitions: crossfade ────────────────────────────────────

    // Clamp the crossfade duration to MAX_CROSSFADE_MS (Requirement 8.2).
    const fadeDuration = Math.min(
      this._manifest.crossfadeDuration * 1000,
      MAX_CROSSFADE_MS
    );

    // Cancel any in-flight stop timer from a previous crossfade to avoid
    // prematurely stopping a track that is currently fading in.
    if (this._crossfadeTimer !== null) {
      clearTimeout(this._crossfadeTimer);
      this._crossfadeTimer = null;
    }

    if (this._soundEnabled) {
      // Fade the outgoing track to silence.
      outgoing.fade(outgoing.volume() as number, 0, fadeDuration);

      // Start the incoming track from silence and fade it up.
      incoming.volume(0);
      incoming.play();
      incoming.fade(0, this._targetVolume, fadeDuration);
    }

    // Schedule the outgoing track to stop once the fade completes.
    // Even when sound is disabled we stop it, so no orphaned playing tracks
    // exist when sound is later re-enabled.
    this._crossfadeTimer = setTimeout(() => {
      outgoing.stop();
      this._crossfadeTimer = null;
    }, fadeDuration);

    this._currentTrack = incoming;
    this._currentIndex = segmentIndex;
  }

  /**
   * Adjust the current track's playback volume based on rider motion state.
   *
   * - Moving (`isMoving = true`):  target = `manifest.motionVolume`
   * - Stationary (`isMoving = false`): target = `manifest.idleVolume`
   *
   * The volume change is applied via a short (0.4 s) GSAP tween on the Howl
   * instance's `volume` property for a smooth perceptual transition.
   *
   * Guard: no tween is issued when `soundEnabled === false` or when there is
   * no active track, preventing unintended volume mutation on a silenced player.
   *
   * Requirements: 8.3, 8.4
   */
  setMotionState(isMoving: boolean): void {
    this._targetVolume = isMoving
      ? this._manifest.motionVolume
      : this._manifest.idleVolume;

    if (this._currentTrack && this._soundEnabled) {
      gsap.to(this._currentTrack, {
        volume: this._targetVolume,
        duration: 0.4,
      });
    }
  }

  /**
   * Mute or unmute all audio tracks.
   *
   * When disabled (`enabled = false`):
   *  - Fades all tracks to volume 0 over a short duration (200 ms).
   *  - Sets `_soundEnabled = false` so subsequent `.play()` and GSAP tween
   *    calls are suppressed by the guards in `transitionToSegment()` and
   *    `setMotionState()`.
   *
   * When re-enabled (`enabled = true`):
   *  - Sets `_soundEnabled = true` to lift the play/tween guards.
   *  - Restores the current track's volume directly to `_targetVolume`
   *    (no fade needed — the track will resume at the correct level
   *    immediately).
   *
   * Requirement: 8.5
   */
  setSoundEnabled(enabled: boolean): void {
    this._soundEnabled = enabled;

    if (!enabled) {
      // Silence every track immediately with a short fade (200 ms).
      const MUTE_FADE_MS = 200;
      for (const track of this._tracks) {
        // Guard against the case where a GSAP tween targeting the Howl
        // instance directly has shadowed the `.volume` prototype method with
        // a plain numeric own-property (e.g. from a synchronous test stub).
        // Reading via the prototype ensures we always get a number.
        const currentVol: number =
          typeof track.volume === "function"
            ? (track.volume() as number)
            : (track.volume as unknown as number);
        track.fade(currentVol, 0, MUTE_FADE_MS);
      }
    } else {
      // Restore the current track to the pre-mute target volume.
      if (this._currentTrack !== null) {
        // Guard against the GSAP tween having shadowed the prototype `.volume`
        // method with a plain numeric own-property. Fall back to the prototype
        // method when the own property is not callable.
        const track = this._currentTrack;
        if (typeof track.volume === "function") {
          track.volume(this._targetVolume);
        } else {
          // Retrieve the prototype method and invoke it on the instance.
          // Cast through unknown to work around overloaded Howl.volume types.
          const volumeFn = (Object.getPrototypeOf(track) as { volume: (v: number) => void }).volume;
          volumeFn.call(track, this._targetVolume);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public getters
  // -------------------------------------------------------------------------

  /**
   * Returns `true` while a crossfade is in progress (i.e. a `setTimeout` for
   * the outgoing track's `stop()` is still pending).
   *
   * Requirements: 8.2
   */
  get isCrossfading(): boolean {
    return this._crossfadeTimer !== null;
  }

  // -------------------------------------------------------------------------
  // Internal accessors (exposed for testing)
  // -------------------------------------------------------------------------

  /** @internal Exposes the track array for unit tests. */
  get _tracksForTesting(): readonly Howl[] {
    return this._tracks;
  }

  /** @internal Exposes the current track for unit tests. */
  get _currentTrackForTesting(): Howl | null {
    return this._currentTrack;
  }

  /** @internal Exposes the current index for unit tests. */
  get _currentIndexForTesting(): number {
    return this._currentIndex;
  }

  /** @internal Exposes the sound-enabled flag for unit tests. */
  get _soundEnabledForTesting(): boolean {
    return this._soundEnabled;
  }

  /** @internal Exposes the target volume for unit tests. */
  get _targetVolumeForTesting(): number {
    return this._targetVolume;
  }
}
