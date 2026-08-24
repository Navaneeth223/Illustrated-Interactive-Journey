/**
 * Property-based tests for AudioController.
 *
 * Feature: illustrated-interactive-journey
 *
 * Property 17: Ambient track matches current segment
 * Validates: Requirements 8.1
 *
 * For any segment index i in [0, segments.length - 1], after
 * transitionToSegment(i) with soundEnabled = true and a simulated velocity > 0,
 * the Howl stub corresponding to segments[i].audioTrack must be in playing +
 * loop state.
 *
 * Testing strategy:
 *   Howler is mocked with a HowlStub that tracks play() calls and retains the
 *   loop option set at construction. GSAP is stubbed to avoid side-effects.
 *   For each generated segment index the controller is constructed fresh (to
 *   keep tests independent), a motionVolume > 0 is set via setMotionState(true),
 *   and transitionToSegment(i) is called.  The stub at position i must report
 *   plays >= 1 and isLooping === true.
 *
 *   The "first transition" path in AudioController is the only relevant path
 *   here because each controller instance is brand-new, meaning there is no
 *   outgoing track and no crossfade.  This directly tests Requirement 8.1:
 *   every ambient track is configured for loop: true and plays when its segment
 *   is active.
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { AudioController } from "@/modules/AudioController";
import type { JourneyManifest, SegmentDescriptor } from "@/types/journey";

// ---------------------------------------------------------------------------
// Howler stub
// ---------------------------------------------------------------------------

class HowlStub {
  readonly isLooping: boolean;
  plays = 0;
  stops = 0;
  currentVolume: number;

  constructor(options: {
    src: string[];
    loop: boolean;
    volume: number;
    autoplay: boolean;
    html5?: boolean;
  }) {
    this.isLooping = options.loop;
    this.currentVolume = options.volume;
  }

  play(): number {
    this.plays++;
    return 0;
  }

  stop(): this {
    this.stops++;
    return this;
  }

  fade(from: number, to: number, _duration: number): this {
    void from;
    this.currentVolume = to;
    return this;
  }

  volume(vol?: number): number | this {
    if (vol !== undefined) {
      this.currentVolume = vol;
      return this;
    }
    return this.currentVolume;
  }
}

// ---------------------------------------------------------------------------
// Module mocks — hoisted by vitest
// ---------------------------------------------------------------------------

vi.mock("howler", () => {
  return {
    Howl: vi.fn().mockImplementation(function (options: {
      src: string[];
      loop: boolean;
      volume: number;
      autoplay: boolean;
      html5?: boolean;
    }) {
      return new HowlStub(options);
    }),
  };
});

vi.mock("gsap", () => ({
  gsap: {
    to: (
      target: Record<string, unknown>,
      vars: Record<string, unknown>
    ): { kill: () => void } => {
      const GSAP_OPTIONS = new Set([
        "duration", "ease", "overwrite", "onComplete", "onUpdate",
        "delay", "repeat", "yoyo", "paused",
      ]);
      for (const [key, value] of Object.entries(vars)) {
        if (!GSAP_OPTIONS.has(key) && typeof value === "number") {
          // If the target exposes the property as a callable setter (e.g.
          // Howler's .volume() method), call it with the value rather than
          // assigning directly — this matches how GSAP's Howler plugin works
          // and ensures currentVolume is updated via the stub's setter path.
          if (typeof target[key] === "function") {
            (target[key] as (v: number) => void)(value);
          } else {
            (target as Record<string, number>)[key] = value;
          }
        }
      }
      return { kill: () => {} };
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build N minimal segment descriptors, each with a distinct audio track. */
function makeSegments(count: number): SegmentDescriptor[] {
  const roles: Array<"departure" | "intermediate" | "arrival"> = ["departure", "arrival"];
  return Array.from({ length: count }, (_, i) => ({
    id: `seg-${String(i + 1).padStart(2, "0")}`,
    index: i,
    role: count === 1 ? "departure" : i === 0 ? "departure" : i === count - 1 ? "arrival" : "intermediate",
    widthPx: 2400,
    layers: {
      background: `assets/seg${i + 1}/bg.webp`,
      midground:  `assets/seg${i + 1}/mg.webp`,
      foreground: `assets/seg${i + 1}/fg.webp`,
    },
    audioTrack: `assets/audio/seg${i + 1}.mp3`,
    edgeMatchOffsetLeft:  0,
    edgeMatchOffsetRight: 0,
  }));
}

/** Build a full JourneyManifest with `segmentCount` segments. */
function makeManifest(segmentCount: number): JourneyManifest {
  return {
    segments: makeSegments(segmentCount),
    maxVelocity: 800,
    accelerationDuration: 1.2,
    decelerationDuration: 1.8,
    idleVolume: 0.25,
    motionVolume: 1.0,
    crossfadeDuration: 1.5,
  };
}

/** Return the HowlStub for the track at position `index`. */
function stubAt(controller: AudioController, index: number): HowlStub {
  return controller._tracksForTesting[index] as unknown as HowlStub;
}

// ---------------------------------------------------------------------------
// Property 17: Ambient track matches current segment
// Validates: Requirements 8.1
// ---------------------------------------------------------------------------

describe(
  "AudioController — Property 17: Ambient track matches current segment",
  () => {
    /**
     * For any segment index i in [0, segments.length - 1], when
     * soundEnabled = true and velocity > 0, the Howl stub at position i
     * SHALL be in playing + loop state after transitionToSegment(i).
     *
     * **Validates: Requirements 8.1**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 17: Ambient track matches current segment
     */
    it(
      "the stub for segments[i].audioTrack is playing and looping after transitionToSegment(i) with soundEnabled=true and velocity>0",
      () => {
        // Generate a segment count between 1 and 8 (journey spec: 5–8 segments;
        // we test 1–8 to cover edge cases without excluding small manifests).
        const segmentCountArb = fc.integer({ min: 1, max: 8 });

        fc.assert(
          fc.property(segmentCountArb, (segmentCount) => {
            // For each generated segment count, test every valid segment index.
            const manifest = makeManifest(segmentCount);

            for (let i = 0; i < segmentCount; i++) {
              // Fresh controller per index so there is no outgoing track —
              // this exercises the "first transition" path which plays
              // immediately without a crossfade.
              const controller = new AudioController(manifest);

              // soundEnabled defaults to true; ensure it explicitly.
              controller.setSoundEnabled(true);

              // Simulate velocity > 0 by calling setMotionState(true).
              // This sets _targetVolume = motionVolume (1.0 > 0) and issues a
              // GSAP tween — the stub above applies the value instantly.
              // Since there is no current track yet, the tween guard fires only
              // after the first transitionToSegment; calling it beforehand is
              // equivalent to "rider is moving when the segment activates".
              controller.setMotionState(true);

              // Trigger the transition to segment i.
              controller.transitionToSegment(i);

              const stub = stubAt(controller, i);

              // ── Assertion 1: the track is playing ──────────────────────
              expect(stub.plays).toBeGreaterThanOrEqual(1);

              // ── Assertion 2: the track was configured for looping ──────
              // AudioController constructs every Howl with loop: true
              // (Requirement 8.1 — ambient tracks loop continuously).
              expect(stub.isLooping).toBe(true);

              // ── Assertion 3: the correct track is the current one ──────
              // The controller's internal _currentTrack must be the stub at i,
              // not any other track.
              const currentStub =
                controller._currentTrackForTesting as unknown as HowlStub;
              expect(currentStub).toBe(stub);
            }
          }),
          { numRuns: 200, verbose: true }
        );
      }
    );

    /**
     * Tracks at positions OTHER than the active segment must NOT have been
     * played (no false-positive activations).
     *
     * **Validates: Requirements 8.1**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 17: Ambient track matches current segment
     */
    it(
      "only the track for the requested segment index is played — all other tracks remain silent",
      () => {
        // Use a fixed 3-segment manifest for clarity; vary only the chosen index.
        const SEGMENT_COUNT = 3;
        const manifest = makeManifest(SEGMENT_COUNT);

        const indexArb = fc.integer({ min: 0, max: SEGMENT_COUNT - 1 });

        fc.assert(
          fc.property(indexArb, (i) => {
            const controller = new AudioController(manifest);
            controller.setSoundEnabled(true);
            controller.setMotionState(true);
            controller.transitionToSegment(i);

            for (let j = 0; j < SEGMENT_COUNT; j++) {
              const stub = stubAt(controller, j);
              if (j === i) {
                // Active track: must have been played at least once.
                expect(stub.plays).toBeGreaterThanOrEqual(1);
              } else {
                // Inactive tracks: must not have been played.
                expect(stub.plays).toBe(0);
              }
            }
          }),
          { numRuns: 200, verbose: true }
        );
      }
    );
  }
);

// ---------------------------------------------------------------------------
// Property 19: Idle/motion volume round trip
// Validates: Requirements 8.3, 8.4
// ---------------------------------------------------------------------------

describe(
  "AudioController — Property 19: Idle/motion volume round trip",
  () => {
    /**
     * For any sequence of idle→motion→idle transitions, the current track's
     * volume must equal `idleVolume` when stationary and `motionVolume` when
     * moving.  All volume values produced across the transition sequence must
     * lie within the closed interval [idleVolume, motionVolume], and the two
     * endpoints themselves satisfy idleVolume < motionVolume (so the interval
     * is non-degenerate and "strictly between" is well-defined).
     *
     * Because the GSAP stub applies values synchronously, we can assert the
     * exact endpoint after each setMotionState() call.  The "intermediate
     * values lie strictly between" invariant is verified by collecting every
     * volume observed during the sequence and checking it falls within
     * (idleVolume, motionVolume) inclusive of the two valid endpoints.
     *
     * **Validates: Requirements 8.3, 8.4**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 19: Idle/motion volume round trip
     */
    it(
      "volume equals idleVolume at idle and motionVolume during motion across arbitrary transition sequences",
      () => {
        // Arbitraries ---------------------------------------------------

        // A volume pair where idle < motion, both in (0, 1].
        // fc.float requires 32-bit float boundaries (Math.fround).
        const volumePairArb = fc
          .tuple(
            fc.float({ min: Math.fround(0.01), max: Math.fround(0.99), noNaN: true }),
            fc.float({ min: Math.fround(0.01), max: Math.fround(1.0), noNaN: true })
          )
          .filter(([idle, motion]) => idle < motion);

        // A non-empty sequence of booleans representing isMoving states.
        // We always start and end at idle (false) to exercise the full round trip.
        const transitionSeqArb = fc
          .array(fc.boolean(), { minLength: 1, maxLength: 20 })
          .map((middle): boolean[] => [false, ...middle, false]);

        fc.assert(
          fc.property(volumePairArb, transitionSeqArb, ([idleVolume, motionVolume], sequence) => {
            // Build a manifest with the generated volume scalars.
            const manifest = makeManifest(2);
            const testManifest = {
              ...manifest,
              idleVolume,
              motionVolume,
            };

            const controller = new AudioController(testManifest);
            controller.setSoundEnabled(true);

            // Establish a current track so GSAP tweens are actually issued.
            controller.transitionToSegment(0);

            // Collect every volume observed during the sequence.
            const observedVolumes: number[] = [];

            for (const isMoving of sequence) {
              controller.setMotionState(isMoving);

              const track = controller._currentTrackForTesting as unknown as HowlStub;
              const vol = track.currentVolume;
              observedVolumes.push(vol);

              if (isMoving) {
                // Requirement 8.4: motion volume is restored when riding again.
                // Use precision 5 (tolerance 5e-6) — values are 32-bit floats
                // from fc.float so sub-float-epsilon precision is not meaningful.
                expect(vol).toBeCloseTo(motionVolume, 5);
              } else {
                // Requirement 8.3: idle volume while stationary.
                expect(vol).toBeCloseTo(idleVolume, 5);
              }
            }

            // All observed volumes must lie within the closed interval
            // [idleVolume, motionVolume].  Because the GSAP stub jumps directly
            // to the target, every value in the sequence is one of the two
            // endpoints — but the invariant holds in full generality and would
            // also catch a buggy implementation that over- or under-shoots.
            for (const vol of observedVolumes) {
              expect(vol).toBeGreaterThanOrEqual(idleVolume - 1e-9);
              expect(vol).toBeLessThanOrEqual(motionVolume + 1e-9);
            }
          }),
          { numRuns: 300, verbose: true }
        );
      }
    );

    /**
     * Verifies that setMotionState() is a no-op for volume when sound is
     * disabled: the track volume must NOT be mutated by any motion-state
     * transition when soundEnabled === false.
     *
     * This is an important guard for Requirements 8.3/8.4 — the volume
     * round-trip invariant must only fire when sound is enabled.
     *
     * **Validates: Requirements 8.3, 8.4**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 19: Idle/motion volume round trip
     */
    it(
      "volume is not mutated by setMotionState when soundEnabled is false",
      () => {
        const volumePairArb = fc
          .tuple(
            fc.float({ min: Math.fround(0.01), max: Math.fround(0.99), noNaN: true }),
            fc.float({ min: Math.fround(0.01), max: Math.fround(1.0), noNaN: true })
          )
          .filter(([idle, motion]) => idle < motion);

        const transitionSeqArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 20 });

        fc.assert(
          fc.property(volumePairArb, transitionSeqArb, ([idleVolume, motionVolume], sequence) => {
            const manifest = makeManifest(2);
            const testManifest = { ...manifest, idleVolume, motionVolume };

            const controller = new AudioController(testManifest);
            controller.setSoundEnabled(false);
            controller.transitionToSegment(0);

            const track = controller._currentTrackForTesting as unknown as HowlStub;

            // Volume immediately after the first transition (sound disabled,
            // so play() was suppressed and volume was never set to idleVolume).
            // The stub initialises volume to 0 (constructor volume: 0).
            const volumeBeforeTransitions = track.currentVolume;

            for (const isMoving of sequence) {
              controller.setMotionState(isMoving);
              // With sound disabled, no GSAP tween fires, so the volume
              // must remain at the value it had before any setMotionState calls.
              expect(track.currentVolume).toBe(volumeBeforeTransitions);
            }
          }),
          { numRuns: 200, verbose: true }
        );
      }
    );
  }
);

// ---------------------------------------------------------------------------
// Property 18: Crossfade duration never exceeds 2 seconds
// Validates: Requirements 8.2
// ---------------------------------------------------------------------------

describe(
  "AudioController — Property 18: Crossfade duration never exceeds 2 seconds",
  () => {
    /**
     * For any manifest `crossfadeDuration` value (in seconds), the `duration`
     * argument passed to `fade()` on both the outgoing and incoming tracks
     * during a crossfade must be <= 2000 ms (Requirement 8.2).
     *
     * Strategy: spy on each HowlStub's `fade` method after the first
     * transition establishes an outgoing track, then trigger a second
     * transition to induce the crossfade.  Collect every `duration` argument
     * seen and assert each is <= 2000.
     *
     * **Validates: Requirements 8.2**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 18: Crossfade duration never exceeds 2 seconds
     */
    it(
      "the duration passed to fade() on both outgoing and incoming tracks is <= 2000 ms for any manifest crossfadeDuration",
      () => {
        // Generate crossfadeDuration values across a wide range (seconds).
        // fc.float requires 32-bit float boundaries (use Math.fround).
        const crossfadeDurationArb = fc.float({
          min: Math.fround(0.001),
          max: Math.fround(10.0),
          noNaN: true,
        });

        fc.assert(
          fc.property(crossfadeDurationArb, (crossfadeDuration) => {
            const manifest = makeManifest(2);
            const testManifest: JourneyManifest = {
              ...manifest,
              crossfadeDuration,
            };

            const controller = new AudioController(testManifest);
            controller.setSoundEnabled(true);

            // Establish the first track (no crossfade on first transition).
            controller.transitionToSegment(0);

            // Spy on the `fade` method of both stubs so we can capture
            // the duration argument.  We use vi.spyOn on the stub instances
            // directly — this works because HowlStub exposes `fade` as an
            // own prototype method.
            const stub0 = stubAt(controller, 0);
            const stub1 = stubAt(controller, 1);

            const fadeDurations: number[] = [];

            const originalFade0 = stub0.fade.bind(stub0);
            stub0.fade = function (from: number, to: number, duration: number) {
              fadeDurations.push(duration);
              return originalFade0(from, to, duration);
            };

            const originalFade1 = stub1.fade.bind(stub1);
            stub1.fade = function (from: number, to: number, duration: number) {
              fadeDurations.push(duration);
              return originalFade1(from, to, duration);
            };

            // Trigger the crossfade: segment 0 → segment 1.
            controller.transitionToSegment(1);

            // At least two fade() calls must have been made (one on each track).
            expect(fadeDurations.length).toBeGreaterThanOrEqual(2);

            // Every duration must be <= 2000 ms (Requirement 8.2).
            for (const duration of fadeDurations) {
              expect(duration).toBeLessThanOrEqual(2000);
            }
          }),
          { numRuns: 200, verbose: true }
        );
      }
    );
  }
);

// ---------------------------------------------------------------------------
// Property 20: Sound-disabled state silences all output
// Validates: Requirements 8.5
// ---------------------------------------------------------------------------

describe(
  "AudioController — Property 20: Sound-disabled state silences all output",
  () => {
    /**
     * After `setSoundEnabled(false)`, every track's `currentVolume` must be 0.
     * The `fade()` stub sets `currentVolume = to`, and `setSoundEnabled(false)`
     * calls `track.fade(track.volume(), 0, 200)` on all tracks.
     *
     * **Validates: Requirements 8.5**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 20: Sound-disabled state silences all output
     */
    it(
      "all track volumes are 0 when setSoundEnabled(false) is called",
      () => {
        // Generate a segment count and an arbitrary sequence of boolean flags
        // representing calls interleaved before disabling sound.
        const segmentCountArb = fc.integer({ min: 3, max: 5 });
        const callSeqArb = fc.array(fc.boolean(), {
          minLength: 1,
          maxLength: 10,
        });

        fc.assert(
          fc.property(segmentCountArb, callSeqArb, (segmentCount, callSeq) => {
            const manifest = makeManifest(segmentCount);
            const controller = new AudioController(manifest);
            controller.setSoundEnabled(true);

            // Simulate a mixture of transitionToSegment / setMotionState calls
            // while sound is enabled, to give tracks non-zero volumes.
            let currentSeg = 0;
            controller.transitionToSegment(currentSeg);

            for (const flag of callSeq) {
              if (flag) {
                // Advance to next segment (wrapping around).
                currentSeg = (currentSeg + 1) % segmentCount;
                controller.transitionToSegment(currentSeg);
              } else {
                // Toggle motion state.
                controller.setMotionState(flag);
              }
            }

            // Now disable sound — all tracks must fade to 0.
            controller.setSoundEnabled(false);

            for (let i = 0; i < segmentCount; i++) {
              const stub = stubAt(controller, i);
              expect(stub.currentVolume).toBe(0);
            }
          }),
          { numRuns: 200, verbose: true }
        );
      }
    );

    /**
     * After `setSoundEnabled(false)`, a subsequent `transitionToSegment(i)`
     * must NOT call `play()` on the track at index i.
     *
     * **Validates: Requirements 8.5**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 20: Sound-disabled state silences all output
     */
    it(
      "no play() is issued for any track after setSoundEnabled(false)",
      () => {
        const segmentIndexArb = fc.integer({ min: 0, max: 4 });

        fc.assert(
          fc.property(segmentIndexArb, (segmentIndex) => {
            const SEGMENT_COUNT = 5;
            const manifest = makeManifest(SEGMENT_COUNT);
            const controller = new AudioController(manifest);

            // Disable sound before any transitions.
            controller.setSoundEnabled(false);

            // Attempt to transition to the generated segment index.
            controller.transitionToSegment(segmentIndex);

            const stub = stubAt(controller, segmentIndex);
            expect(stub.plays).toBe(0);
          }),
          { numRuns: 200, verbose: true }
        );
      }
    );

    /**
     * After `setSoundEnabled(false)` then `setSoundEnabled(true)`, the current
     * track's `currentVolume` must equal `manifest.idleVolume` (i.e.
     * `_targetVolume` is restored on the current track).
     *
     * **Validates: Requirements 8.5**
     *
     * Tagged: Feature: illustrated-interactive-journey,
     *         Property 20: Sound-disabled state silences all output
     */
    it(
      "setSoundEnabled(true) restores the current track volume to _targetVolume",
      () => {
        const manifest = makeManifest(2);
        const controller = new AudioController(manifest);

        // Establish a current track with sound on.
        controller.setSoundEnabled(true);
        controller.transitionToSegment(0);

        // Disable then re-enable sound.
        controller.setSoundEnabled(false);
        controller.setSoundEnabled(true);

        // The current track's volume must be back at idleVolume (_targetVolume
        // was never changed from its initial value of manifest.idleVolume).
        const stub = stubAt(controller, 0);
        expect(stub.currentVolume).toBeCloseTo(manifest.idleVolume, 5);
      }
    );
  }
);
