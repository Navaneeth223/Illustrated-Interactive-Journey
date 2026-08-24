/**
 * Property-based tests for JourneyController.
 *
 * Feature: illustrated-interactive-journey
 *
 * Property 22: WebGL context loss preserves journey position
 * Validates: Requirements 9.5
 *
 * For any journey state where a `webglcontextlost` event is simulated, after
 * the renderer successfully restores the context, `journeyController.worldPosition`
 * SHALL equal the position recorded at the time of context loss.
 */

import { describe, it, vi } from "vitest";
import { expect } from "vitest";
import * as fc from "fast-check";
import { JourneyController } from "@/modules/JourneyController";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("gsap", () => ({
  gsap: {
    to: (
      target: Record<string, number>,
      vars: Record<string, unknown>
    ): { kill: () => void } => {
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

vi.mock("howler", () => ({
  Howler: { ctx: { resume: vi.fn().mockResolvedValue(undefined) } },
  Howl: vi.fn().mockImplementation(() => ({
    play: vi.fn(),
    stop: vi.fn(),
    fade: vi.fn(),
    volume: vi.fn().mockReturnValue(0),
  })),
}));

// ---------------------------------------------------------------------------
// Lightweight stubs
// ---------------------------------------------------------------------------

function makeVelocityModelStub() {
  let _worldPosition = 0;
  const stub = {
    _state: { velocity: 0 },
    get worldPosition() { return _worldPosition; },
    set _worldPosition(v: number) { _worldPosition = v; },
    get velocity() { return 0; },
    tick: vi.fn(),
    startHold: vi.fn(),
    releaseHold: vi.fn(),
  };
  return stub;
}

function makeSequencerStub() {
  return {
    update: vi.fn(),
    activeSegments: [] as Array<{ worldX: number; descriptor: { widthPx: number } }>,
    get isAtArrival() { return false; },
    forceReloadAll: vi.fn(),
    totalWorldWidth: 200_000,
  };
}

function makePixiRendererStub() {
  return {
    render: vi.fn(),
  };
}

function makeAudioControllerStub() {
  return {
    transitionToSegment: vi.fn(),
    setMotionState: vi.fn(),
    setSoundEnabled: vi.fn(),
  };
}

function makeAudioGateStub() {
  return {
    show: vi.fn().mockResolvedValue("sound-off" as const),
  };
}

function makeInputControllerStub() {
  return {
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeArrivalScreenStub() {
  return {
    show: vi.fn(),
    hide: vi.fn(),
  };
}

function makeAppStub() {
  const canvas = document.createElement("canvas");
  return {
    canvas,
    renderer: {
      reset: vi.fn(),
      resolution: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Property 22: WebGL context loss preserves journey position
// Validates: Requirements 9.5
// ---------------------------------------------------------------------------

describe("JourneyController — Property 22: WebGL context loss preserves journey position", () => {
  /**
   * For any arbitrary world position, dispatching a synthetic `webglcontextlost`
   * event on the canvas followed by `webglcontextrestored` SHALL result in
   * `journeyController.worldPosition` equalling the position at context loss.
   *
   * **Validates: Requirements 9.5**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 22: WebGL context loss preserves journey position
   */
  it(
    "worldPosition after context restore equals worldPosition at context loss",
    () => {
      // Stub requestAnimationFrame to avoid scheduling real frames.
      vi.stubGlobal("requestAnimationFrame", vi.fn());
      vi.stubGlobal("performance", { now: vi.fn().mockReturnValue(0) });

      // Arbitrary integer world positions: 0 to 100_000 px.
      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });

      fc.assert(
        fc.property(worldPositionArb, (worldPosition) => {
          // --- Build stubs ---------------------------------------------------
          const velocityModel = makeVelocityModelStub();
          const sequencer = makeSequencerStub();
          const pixiRenderer = makePixiRendererStub();
          const audioController = makeAudioControllerStub();
          const audioGate = makeAudioGateStub();
          const inputController = makeInputControllerStub();
          const arrivalScreen = makeArrivalScreenStub();
          const app = makeAppStub();

          const controller = new JourneyController(
            audioGate as never,
            velocityModel as never,
            sequencer as never,
            pixiRenderer as never,
            audioController as never,
            inputController as never,
            arrivalScreen as never,
            app as never,
          );

          // --- Seed the controller to the target position -------------------
          // Directly set the internal _worldPosition on the velocity model
          // (mimics seekTo / position accumulation during travel).
          velocityModel._worldPosition = worldPosition;
          expect(controller.worldPosition).toBe(worldPosition);

          // --- Simulate webglcontextlost ------------------------------------
          const lostEvent = new Event("webglcontextlost", { bubbles: false, cancelable: true });
          app.canvas.dispatchEvent(lostEvent);

          // --- Simulate webglcontextrestored --------------------------------
          const restoredEvent = new Event("webglcontextrestored", { bubbles: false });
          app.canvas.dispatchEvent(restoredEvent);

          // --- Assert: worldPosition equals position at context loss --------
          // seekTo(savedPosition) sets _worldPosition on the velocity model
          // back to the saved value — so worldPosition must equal worldPosition.
          expect(controller.worldPosition).toBe(worldPosition);
        }),
        { numRuns: 100, verbose: true }
      );

      vi.unstubAllGlobals();
    }
  );
});
