/**
 * Unit tests for AudioController.
 *
 * Howler is stubbed with a lightweight class that tracks calls to
 * `.play()`, `.stop()`, `.fade()`, and `.volume()`.
 * GSAP's `gsap.to` is stubbed to set the target value instantly so volume
 * assertions can be made synchronously.
 *
 * Requirements: 8.1, 8.2
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioController } from "@/modules/AudioController";
import type { JourneyManifest } from "@/types/journey";

// ---------------------------------------------------------------------------
// Howler stub
// ---------------------------------------------------------------------------

/** Tracks all calls made to a single Howl instance. */
interface HowlCallRecord {
  plays: number;
  stops: number;
  fades: Array<{ from: number; to: number; duration: number }>;
  currentVolume: number;
  isLooping: boolean;
}

class HowlStub {
  readonly record: HowlCallRecord = {
    plays: 0,
    stops: 0,
    fades: [],
    currentVolume: 0,
    isLooping: true,
  };

  constructor(options: {
    src: string[];
    loop: boolean;
    volume: number;
    autoplay: boolean;
    html5?: boolean;
  }) {
    this.record.currentVolume = options.volume;
    this.record.isLooping = options.loop;
  }

  play(): number {
    this.record.plays++;
    return 0; // fake sound id
  }

  stop(): this {
    this.record.stops++;
    return this;
  }

  fade(from: number, to: number, duration: number): this {
    this.record.fades.push({ from, to, duration });
    // Apply the target volume so subsequent volume() calls reflect the result.
    this.record.currentVolume = to;
    return this;
  }

  volume(vol?: number): number | this {
    if (vol !== undefined) {
      this.record.currentVolume = vol;
      return this;
    }
    return this.record.currentVolume;
  }
}

// ---------------------------------------------------------------------------
// GSAP stub — sets target property instantly and records calls
// ---------------------------------------------------------------------------

/** Tracks all gsap.to() invocations for assertions. */
const gsapCalls: Array<{ target: Record<string, unknown>; vars: Record<string, unknown> }> = [];

vi.mock("gsap", () => ({
  gsap: {
    to: (
      target: Record<string, number>,
      vars: Record<string, unknown>
    ): { kill: () => void } => {
      gsapCalls.push({ target: target as Record<string, unknown>, vars });
      const GSAP_OPTIONS = new Set([
        "duration", "ease", "overwrite", "onComplete", "onUpdate",
        "delay", "repeat", "yoyo", "paused",
      ]);
      for (const [key, value] of Object.entries(vars)) {
        if (!GSAP_OPTIONS.has(key) && typeof value === "number") {
          target[key] = value;
        }
      }
      return { kill: () => {} };
    },
  },
}));

// ---------------------------------------------------------------------------
// Howler stub injection
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal JourneyManifest sufficient for AudioController tests. */
function makeManifest(overrides: Partial<JourneyManifest> = {}): JourneyManifest {
  return {
    segments: [
      {
        id: "seg-01",
        index: 0,
        role: "departure",
        widthPx: 2400,
        layers: {
          background: "assets/seg01/bg.webp",
          midground: "assets/seg01/mg.webp",
          foreground: "assets/seg01/fg.webp",
        },
        audioTrack: "assets/audio/seg01.mp3",
        edgeMatchOffsetLeft: 0,
        edgeMatchOffsetRight: 0,
      },
      {
        id: "seg-02",
        index: 1,
        role: "intermediate",
        widthPx: 2400,
        layers: {
          background: "assets/seg02/bg.webp",
          midground: "assets/seg02/mg.webp",
          foreground: "assets/seg02/fg.webp",
        },
        audioTrack: "assets/audio/seg02.mp3",
        edgeMatchOffsetLeft: 0,
        edgeMatchOffsetRight: 0,
      },
      {
        id: "seg-03",
        index: 2,
        role: "arrival",
        widthPx: 2400,
        layers: {
          background: "assets/seg03/bg.webp",
          midground: "assets/seg03/mg.webp",
          foreground: "assets/seg03/fg.webp",
        },
        audioTrack: "assets/audio/seg03.mp3",
        edgeMatchOffsetLeft: 0,
        edgeMatchOffsetRight: 0,
      },
    ],
    maxVelocity: 800,
    accelerationDuration: 1.2,
    decelerationDuration: 1.8,
    idleVolume: 0.25,
    motionVolume: 1.0,
    crossfadeDuration: 1.5, // seconds
    ...overrides,
  };
}

/** Returns the HowlStub underlying a track exposed via the internal accessor. */
function stubFor(controller: AudioController, index: number): HowlStub {
  return controller._tracksForTesting[index] as unknown as HowlStub;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AudioController — construction", () => {
  it("creates one Howl instance per segment", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    expect(controller._tracksForTesting.length).toBe(3);
  });

  it("initialises all tracks with loop:true, volume:0, autoplay:false", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);

    for (let i = 0; i < manifest.segments.length; i++) {
      const stub = stubFor(controller, i);
      expect(stub.record.isLooping).toBe(true);
      expect(stub.record.currentVolume).toBe(0);
      expect(stub.record.plays).toBe(0);
    }
  });

  it("does not play any track on construction", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);

    for (let i = 0; i < manifest.segments.length; i++) {
      expect(stubFor(controller, i).record.plays).toBe(0);
    }
  });

  it("starts with isCrossfading === false", () => {
    const controller = new AudioController(makeManifest());
    expect(controller.isCrossfading).toBe(false);
  });

  it("target volume defaults to idleVolume", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    expect(controller._targetVolumeForTesting).toBe(manifest.idleVolume);
  });
});

// ---------------------------------------------------------------------------

describe("AudioController — transitionToSegment(): first transition (no outgoing)", () => {
  it("plays the incoming track immediately", () => {
    const controller = new AudioController(makeManifest());
    controller.transitionToSegment(0);
    expect(stubFor(controller, 0).record.plays).toBe(1);
  });

  it("sets volume to idleVolume before playing (no fade needed)", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);
    expect(stubFor(controller, 0).record.currentVolume).toBe(manifest.idleVolume);
  });

  it("does not start isCrossfading on first transition", () => {
    const controller = new AudioController(makeManifest());
    controller.transitionToSegment(0);
    expect(controller.isCrossfading).toBe(false);
  });

  it("does not call fade on first transition", () => {
    const controller = new AudioController(makeManifest());
    controller.transitionToSegment(0);
    expect(stubFor(controller, 0).record.fades.length).toBe(0);
  });

  it("updates _currentIndex", () => {
    const controller = new AudioController(makeManifest());
    controller.transitionToSegment(0);
    expect(controller._currentIndexForTesting).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("AudioController — transitionToSegment(): subsequent transitions (crossfade)", () => {
  let controller: AudioController;
  let manifest: JourneyManifest;

  beforeEach(() => {
    vi.useFakeTimers();
    manifest = makeManifest({ crossfadeDuration: 1.5 });
    controller = new AudioController(manifest);
    controller.transitionToSegment(0); // Establish track 0 as outgoing
  });

  it("fades the outgoing track from its volume to 0", () => {
    controller.transitionToSegment(1);
    const outgoingFades = stubFor(controller, 0).record.fades;
    expect(outgoingFades.length).toBe(1);
    expect(outgoingFades[0].to).toBe(0);
  });

  it("plays the incoming track", () => {
    controller.transitionToSegment(1);
    expect(stubFor(controller, 1).record.plays).toBe(1);
  });

  it("fades the incoming track from 0 to targetVolume", () => {
    controller.transitionToSegment(1);
    const incomingFades = stubFor(controller, 1).record.fades;
    expect(incomingFades.length).toBe(1);
    expect(incomingFades[0].from).toBe(0);
    expect(incomingFades[0].to).toBe(manifest.idleVolume);
  });

  it("both fades use the same duration", () => {
    controller.transitionToSegment(1);
    const outDuration = stubFor(controller, 0).record.fades[0].duration;
    const inDuration = stubFor(controller, 1).record.fades[0].duration;
    expect(outDuration).toBe(inDuration);
  });

  it("sets isCrossfading to true during the fade", () => {
    controller.transitionToSegment(1);
    expect(controller.isCrossfading).toBe(true);
  });

  it("stops the outgoing track after the fade completes", () => {
    controller.transitionToSegment(1);
    expect(stubFor(controller, 0).record.stops).toBe(0); // not yet
    vi.runAllTimers();
    expect(stubFor(controller, 0).record.stops).toBe(1); // fired after timeout
  });

  it("clears isCrossfading after the fade timer fires", () => {
    controller.transitionToSegment(1);
    vi.runAllTimers();
    expect(controller.isCrossfading).toBe(false);
  });

  it("updates _currentIndex to the incoming segment", () => {
    controller.transitionToSegment(1);
    expect(controller._currentIndexForTesting).toBe(1);
  });

  it("does not re-trigger a transition to the same segment", () => {
    controller.transitionToSegment(0); // already on 0
    expect(stubFor(controller, 0).record.fades.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("AudioController — crossfade duration clamping (Requirement 8.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("uses the manifest crossfadeDuration when it is under 2000 ms", () => {
    const manifest = makeManifest({ crossfadeDuration: 1.5 }); // 1500 ms
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);
    controller.transitionToSegment(1);

    const fadeDuration = stubFor(controller, 0).record.fades[0].duration;
    expect(fadeDuration).toBe(1500);
  });

  it("clamps crossfadeDuration to 2000 ms when manifest value exceeds 2 seconds", () => {
    const manifest = makeManifest({ crossfadeDuration: 5.0 }); // 5000 ms — exceeds cap
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);
    controller.transitionToSegment(1);

    const fadeDuration = stubFor(controller, 0).record.fades[0].duration;
    expect(fadeDuration).toBe(2000);
  });

  it("allows exactly 2000 ms (boundary)", () => {
    const manifest = makeManifest({ crossfadeDuration: 2.0 }); // exactly at cap
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);
    controller.transitionToSegment(1);

    const fadeDuration = stubFor(controller, 0).record.fades[0].duration;
    expect(fadeDuration).toBe(2000);
  });

  it("uses a very short fade duration (near 0)", () => {
    const manifest = makeManifest({ crossfadeDuration: 0.01 }); // 10 ms
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);
    controller.transitionToSegment(1);

    const fadeDuration = stubFor(controller, 0).record.fades[0].duration;
    expect(fadeDuration).toBe(10);
  });
});

// ---------------------------------------------------------------------------

describe("AudioController — setMotionState()", () => {
  beforeEach(() => {
    gsapCalls.length = 0; // reset call recorder before each test
  });

  it("updates _targetVolume to motionVolume when moving", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.setMotionState(true);
    expect(controller._targetVolumeForTesting).toBe(manifest.motionVolume);
  });

  it("updates _targetVolume to idleVolume when not moving", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.setMotionState(true);
    controller.setMotionState(false);
    expect(controller._targetVolumeForTesting).toBe(manifest.idleVolume);
  });

  it("issues a GSAP tween targeting the current track with motionVolume when moving", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0); // establish a current track

    controller.setMotionState(true);

    expect(gsapCalls.length).toBe(1);
    expect(gsapCalls[0].target).toBe(controller._currentTrackForTesting);
    expect(gsapCalls[0].vars.volume).toBe(manifest.motionVolume);
    expect(gsapCalls[0].vars.duration).toBe(0.4);
  });

  it("issues a GSAP tween targeting the current track with idleVolume when stationary", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    controller.setMotionState(false);

    expect(gsapCalls.length).toBe(1);
    expect(gsapCalls[0].target).toBe(controller._currentTrackForTesting);
    expect(gsapCalls[0].vars.volume).toBe(manifest.idleVolume);
    expect(gsapCalls[0].vars.duration).toBe(0.4);
  });

  it("does NOT issue a GSAP tween when soundEnabled is false (guard)", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    controller.setSoundEnabled(false);
    controller.setMotionState(true);

    expect(gsapCalls.length).toBe(0);
  });

  it("does NOT issue a GSAP tween when there is no current track", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    // No transitionToSegment — _currentTrack is null
    controller.setMotionState(true);
    expect(gsapCalls.length).toBe(0);
    controller.setMotionState(false);
    expect(gsapCalls.length).toBe(0);
  });

  it("still updates _targetVolume even when soundEnabled is false", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.setSoundEnabled(false);
    controller.setMotionState(true);
    expect(controller._targetVolumeForTesting).toBe(manifest.motionVolume);
  });
});

// ---------------------------------------------------------------------------

describe("AudioController — setSoundEnabled()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gsapCalls.length = 0;
  });

  // ── Flag management ────────────────────────────────────────────────────────

  it("sets the sound-enabled flag to false", () => {
    const controller = new AudioController(makeManifest());
    controller.setSoundEnabled(false);
    expect(controller._soundEnabledForTesting).toBe(false);
  });

  it("sets the sound-enabled flag back to true", () => {
    const controller = new AudioController(makeManifest());
    controller.setSoundEnabled(false);
    controller.setSoundEnabled(true);
    expect(controller._soundEnabledForTesting).toBe(true);
  });

  // ── Disabling: fades all tracks to 0 ──────────────────────────────────────

  it("fades every track to volume 0 when disabled", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);

    // Establish a playing track so track 0 has non-zero volume.
    controller.transitionToSegment(0);

    controller.setSoundEnabled(false);

    for (let i = 0; i < manifest.segments.length; i++) {
      const stub = stubFor(controller, i);
      // Each track should have received exactly one fade call targeting 0.
      const fadeToZero = stub.record.fades.filter((f) => f.to === 0);
      expect(fadeToZero.length).toBeGreaterThanOrEqual(1);
      expect(fadeToZero[fadeToZero.length - 1].to).toBe(0);
    }
  });

  it("fades all tracks to 0 even when no track has been played yet", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    // No transition — no track is playing.
    controller.setSoundEnabled(false);

    for (let i = 0; i < manifest.segments.length; i++) {
      const stub = stubFor(controller, i);
      // Each track gets a fade call (from 0 to 0 is still a valid Howler call).
      expect(stub.record.fades.length).toBeGreaterThanOrEqual(1);
      expect(stub.record.fades[stub.record.fades.length - 1].to).toBe(0);
    }
  });

  it("uses a short fade duration (≤ 500 ms) when muting", () => {
    const controller = new AudioController(makeManifest());
    controller.transitionToSegment(0);
    controller.setSoundEnabled(false);

    for (let i = 0; i < 3; i++) {
      const stub = stubFor(controller, i);
      if (stub.record.fades.length > 0) {
        const muteFade = stub.record.fades[stub.record.fades.length - 1];
        expect(muteFade.duration).toBeLessThanOrEqual(500);
        expect(muteFade.duration).toBeGreaterThan(0);
      }
    }
  });

  it("all tracks report volume 0 after being disabled", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    controller.setSoundEnabled(false);

    for (let i = 0; i < manifest.segments.length; i++) {
      const stub = stubFor(controller, i);
      expect(stub.record.currentVolume).toBe(0);
    }
  });

  // ── Re-enabling: restores current track volume ────────────────────────────

  it("restores the current track volume to _targetVolume when re-enabled", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    controller.setSoundEnabled(false);
    controller.setSoundEnabled(true);

    const currentStub = stubFor(controller, 0);
    expect(currentStub.record.currentVolume).toBe(manifest.idleVolume);
  });

  it("restores volume to motionVolume when re-enabled after setMotionState(true)", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);
    controller.setMotionState(true);

    controller.setSoundEnabled(false);
    controller.setSoundEnabled(true);

    const currentStub = stubFor(controller, 0);
    expect(currentStub.record.currentVolume).toBe(manifest.motionVolume);
  });

  it("does NOT restore volume when there is no current track", () => {
    const controller = new AudioController(makeManifest());
    // No transitionToSegment — no current track.
    controller.setSoundEnabled(false);
    // Should not throw; no track to restore.
    expect(() => controller.setSoundEnabled(true)).not.toThrow();
  });

  it("does not mutate non-current tracks' volume when re-enabled", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    controller.setSoundEnabled(false);
    controller.setSoundEnabled(true);

    // Tracks 1 and 2 were never the current track — they should remain at 0.
    expect(stubFor(controller, 1).record.currentVolume).toBe(0);
    expect(stubFor(controller, 2).record.currentVolume).toBe(0);
  });

  // ── Play suppression ───────────────────────────────────────────────────────

  it("suppresses play() when sound is disabled on first transition", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.setSoundEnabled(false);
    controller.transitionToSegment(0);
    expect(stubFor(controller, 0).record.plays).toBe(0);
  });

  it("suppresses fade-in and play() on crossfade transition when disabled", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0); // establish track 0 as current

    controller.setSoundEnabled(false);
    // Reset fades recorded during the mute call so we only see the crossfade.
    for (let i = 0; i < manifest.segments.length; i++) {
      stubFor(controller, i).record.fades.length = 0;
    }

    controller.transitionToSegment(1);

    // Incoming track must not be played.
    expect(stubFor(controller, 1).record.plays).toBe(0);
    // Incoming track must not receive a fade-in.
    expect(stubFor(controller, 1).record.fades.length).toBe(0);
    // Outgoing track must not receive a fade-out (sound is already 0).
    expect(stubFor(controller, 0).record.fades.length).toBe(0);
  });

  it("still schedules the outgoing stop timer even when disabled (prevents orphaned tracks)", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    controller.setSoundEnabled(false);
    controller.transitionToSegment(1);

    // isCrossfading should be true — the stop timer is still scheduled.
    expect(controller.isCrossfading).toBe(true);

    vi.runAllTimers();
    // After the timer fires, outgoing track 0 must be stopped.
    expect(stubFor(controller, 0).record.stops).toBeGreaterThanOrEqual(1);
    expect(controller.isCrossfading).toBe(false);
  });

  // ── Re-enabled after mute: playback flows normally ─────────────────────────

  it("allows play() on subsequent transitionToSegment after re-enabling", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.setSoundEnabled(false);
    controller.setSoundEnabled(true);
    controller.transitionToSegment(0);
    expect(stubFor(controller, 0).record.plays).toBe(1);
  });

  it("allows GSAP tween on setMotionState after re-enabling", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);
    controller.setSoundEnabled(false);
    controller.setSoundEnabled(true);

    controller.setMotionState(true);

    expect(gsapCalls.length).toBe(1);
    expect(gsapCalls[0].vars.volume).toBe(manifest.motionVolume);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it("calling setSoundEnabled(false) twice does not double-fade tracks", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    // Count fades before.
    const beforeCount = stubFor(controller, 0).record.fades.length;
    controller.setSoundEnabled(false);
    const afterFirst = stubFor(controller, 0).record.fades.length;

    controller.setSoundEnabled(false); // second call
    const afterSecond = stubFor(controller, 0).record.fades.length;

    // Both calls issue fades, but each call adds exactly one more fade entry.
    expect(afterFirst - beforeCount).toBe(1);
    expect(afterSecond - afterFirst).toBe(1);
  });

  it("calling setSoundEnabled(true) when already enabled does not crash or corrupt volume", () => {
    const manifest = makeManifest();
    const controller = new AudioController(manifest);
    controller.transitionToSegment(0);

    // Already enabled by default.
    expect(() => controller.setSoundEnabled(true)).not.toThrow();
    expect(stubFor(controller, 0).record.currentVolume).toBe(manifest.idleVolume);
  });
});
