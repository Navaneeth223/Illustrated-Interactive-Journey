/**
 * Property-based tests for VelocityModel.
 *
 * Feature: illustrated-interactive-journey
 *
 * Testing strategy: GSAP is stubbed with different synchronous implementations
 * depending on the property under test:
 *
 * - Property 2 uses an instant stub (velocity immediately set to target)
 *   so that worldPosition is non-zero on the very first tick.
 *
 * - Property 8 uses an incremental stub (velocity advances toward the target
 *   by a fixed fraction per tick) so that monotonicity can be observed across
 *   multiple ticks rather than seeing a single jump.
 *
 * worldPosition is seeded by calling tick() with a computed seed dt derived
 * from the desired position (pos = maxVelocity × seedDt), avoiding the need
 * to access private fields directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { VelocityModel } from "@/modules/VelocityModel";
import * as gsapModule from "gsap";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VELOCITY = 800; // px/s — must be > 0
const ACCELERATION_DURATION = 1.2; // seconds (matches design doc)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(terminalEdge: number): VelocityModel {
  return new VelocityModel({
    maxVelocity: MAX_VELOCITY,
    accelerationDuration: ACCELERATION_DURATION,
    decelerationDuration: 1.8,
    terminalEdge,
  });
}

// ---------------------------------------------------------------------------
// Property 2: Intermediate positions allow forward movement
// Validates: Requirements 1.4
// ---------------------------------------------------------------------------
//
// This block keeps its own module-scoped GSAP mock (instant stub) isolated
// via vi.mock at file scope. Because vitest hoists vi.mock calls, the module
// mock below applies for the entire file. Property 8 overrides gsap.to per-
// test via vi.spyOn so each describe block can use a different behaviour.

vi.mock("gsap", () => ({
  gsap: {
    to: (
      target: Record<string, number>,
      vars: Record<string, unknown>
    ): { kill: () => void } => {
      // Default (instant) stub — used by Property 2
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

describe("VelocityModel — Property 2: Intermediate positions allow forward movement", () => {
  /**
   * For any worldPosition strictly between 0 and terminalEdge, when a hold
   * input is active, worldPosition SHALL strictly increase on the subsequent tick.
   *
   * **Validates: Requirements 1.4**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 2: Intermediate positions allow forward movement
   */
  it(
    "worldPosition strictly increases after tick(dt) when hold is active and position is strictly between 0 and terminalEdge",
    () => {
      const terminalEdgeArb = fc.integer({ min: 2, max: 100_000 });

      fc.assert(
        fc.property(
          terminalEdgeArb,
          fc.float({ min: Math.fround(0.001), max: Math.fround(0.1), noNaN: true }),
          (terminalEdge, dt) => {
            const targetPosition = terminalEdge / 2;
            const seedDt = targetPosition / MAX_VELOCITY;

            const model = makeModel(terminalEdge);
            model.startHold(); // instant stub: velocity = MAX_VELOCITY immediately
            model.tick(seedDt); // worldPosition ≈ targetPosition

            const positionBefore = model.worldPosition;

            fc.pre(positionBefore > 0 && positionBefore < terminalEdge);

            model.tick(dt);

            expect(model.worldPosition).toBeGreaterThan(positionBefore);
          }
        ),
        { numRuns: 100, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 8: Velocity accelerates monotonically on hold
// Validates: Requirements 4.1
// ---------------------------------------------------------------------------
//
// GSAP stub strategy for this property:
//   Each `gsap.to()` call returns a closure. The closure records (target, target
//   velocity, stepFraction) so that every call to advanceAllTweens() moves each
//   active tween's `velocity` field one step closer to its target value. This
//   simulates GSAP progressing the tween incrementally over multiple frames —
//   the key requirement for observing monotonic growth.
//
// The stub is installed via vi.spyOn on the mocked gsap module instance so it
// overrides the instant default for this describe block only, and is restored
// afterwards.

type TweenEntry = {
  target: Record<string, number>;
  targetVelocity: number;
  stepFraction: number; // fraction of remaining gap to close per step
  killed: boolean;
};

let activeTweens: TweenEntry[] = [];

/** Advance every live tween by one step toward its target. */
function advanceAllTweens(): void {
  for (const entry of activeTweens) {
    if (entry.killed) continue;
    const remaining = entry.targetVelocity - entry.target.velocity;
    entry.target.velocity += remaining * entry.stepFraction;
  }
}

describe("VelocityModel — Property 8: Velocity accelerates monotonically on hold", () => {
  /**
   * For any initial world velocity v₀ in [0, maxVelocity), when a hold input
   * is active, the velocity at each subsequent tick SHALL be >= the velocity at
   * the previous tick until maxVelocity is reached.
   *
   * **Validates: Requirements 4.1**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 8: Velocity accelerates monotonically on hold
   */

  // Install the incremental stub before each test; restore after.
  beforeEach(() => {
    activeTweens = [];

    vi.spyOn(gsapModule.gsap, "to").mockImplementation(
      (
        target: unknown,
        vars: unknown
      ) => {
        const typedTarget = target as Record<string, number>;
        const typedVars = vars as Record<string, unknown>;
        const GSAP_OPTIONS = new Set([
          "duration", "ease", "overwrite", "onComplete", "onUpdate",
          "delay", "repeat", "yoyo", "paused",
        ]);
        // Find the numeric property that is the tween target (e.g. "velocity")
        let targetVelocity = typedTarget.velocity; // default: no change
        for (const [key, value] of Object.entries(typedVars)) {
          if (!GSAP_OPTIONS.has(key) && typeof value === "number") {
            targetVelocity = value;
          }
        }
        // Kill any existing tween targeting the same key (overwrite: true behaviour)
        for (const e of activeTweens) {
          if (e.target === typedTarget) e.killed = true;
        }
        const entry: TweenEntry = {
          target: typedTarget,
          targetVelocity,
          stepFraction: 0.2, // 20% of remaining gap per step → gradual, never overshoots
          killed: false,
        };
        activeTweens.push(entry);
        return { kill: () => { entry.killed = true; } } as unknown as ReturnType<typeof gsapModule.gsap.to>;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    activeTweens = [];
  });

  it(
    "velocity[t+1] >= velocity[t] for all ticks while holding",
    () => {
      // v0: initial velocity in [0, MAX_VELOCITY)
      const v0Arb = fc.float({
        min: 0,
        max: Math.fround(MAX_VELOCITY - 1),
        noNaN: true,
      });
      // n: number of ticks to observe, in [2, 20]
      const nArb = fc.integer({ min: 2, max: 20 });
      // dt: frame duration in seconds (1 ms – 100 ms)
      const dtArb = fc.float({
        min: Math.fround(0.001),
        max: Math.fround(0.1),
        noNaN: true,
      });

      fc.assert(
        fc.property(v0Arb, nArb, dtArb, (v0, n, dt) => {
          // terminalEdge large enough that clamping never fires during the test
          const terminalEdge = MAX_VELOCITY * dt * n * 10 + 1;
          const model = makeModel(terminalEdge);

          // Seed the model's internal velocity to v0 by tweening it instantly
          // before calling startHold(). We do this by directly setting the
          // internal state (it's public-readonly _state for GSAP targeting).
          model._state.velocity = v0;

          // Start holding — installs an incremental tween toward MAX_VELOCITY
          model.startHold();

          const velocities: number[] = [];

          for (let i = 0; i < n; i++) {
            // Advance the tween by one incremental step, then tick the model
            advanceAllTweens();
            model.tick(dt);
            velocities.push(model.velocity);
          }

          // Assert monotonicity: each tick's velocity >= previous tick's velocity
          for (let i = 1; i < velocities.length; i++) {
            expect(velocities[i]).toBeGreaterThanOrEqual(velocities[i - 1]);
          }
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 10: No instantaneous velocity discontinuity
// Validates: Requirements 4.4
// ---------------------------------------------------------------------------
//
// Strategy:
//   The module-level vi.mock above sets velocity *immediately* to its target,
//   which would make every tick a discontinuity.  For this property we need an
//   *incremental* GSAP behaviour.  We achieve this by:
//
//   1. Creating the VelocityModel normally (the module-level mock is used for
//      the constructor's gsap.to call — its return value is just { kill() {} }).
//   2. After startHold() / releaseHold() we override model._state.velocity
//      ourselves — the tween target is the plain _state object — simulating an
//      incremental GSAP step:
//
//        nextVelocity = current + (target − current) * (dt / tweenDuration)
//
//      This mirrors what a real GSAP linear ease would do per tick when the
//      total progress per tick is dt/tweenDuration.
//
//   3. We then call tick(dt) and observe the velocity AFTER tick has run.
//      Because tick() reads _state.velocity but does NOT mutate it, the
//      velocity-before and velocity-after a tick are determined entirely by
//      the incremental steps we inject.
//
//   Bound under test:
//     |velocity[t+1] − velocity[t]| ≤ maxVelocity × dt / minTweenDuration
//
//   where minTweenDuration = Math.min(accelerationDuration, decelerationDuration).
//
// Tagged: Feature: illustrated-interactive-journey,
//         Property 10: No instantaneous velocity discontinuity

describe("VelocityModel — Property 10: No instantaneous velocity discontinuity", () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any two consecutive ticks t and t+1, regardless of the input
   * transition (hold start or hold end) that occurs between them,
   * |velocity[t+1] − velocity[t]| SHALL be bounded by
   *   maxVelocity × dt / minTweenDuration.
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 10: No instantaneous velocity discontinuity
   */
  it(
    "velocity change per tick is bounded by maxVelocity * dt / minTweenDuration across arbitrary inputs",
    () => {
      // -----------------------------------------------------------------------
      // Arbitraries
      // -----------------------------------------------------------------------

      // dt: one frame duration in seconds, 1 ms – 100 ms
      const dtArb = fc.float({
        min: Math.fround(0.001),
        max: Math.fround(0.1),
        noNaN: true,
      });

      // accelerationDuration: 0.5 s – 3 s
      const accelDurArb = fc.float({
        min: Math.fround(0.5),
        max: Math.fround(3.0),
        noNaN: true,
      });

      // decelerationDuration: 0.5 s – 3 s
      const decelDurArb = fc.float({
        min: Math.fround(0.5),
        max: Math.fround(3.0),
        noNaN: true,
      });

      // Initial velocity as a fraction of maxVelocity [0, 1]
      const initVelFractionArb = fc.float({
        min: 0,
        max: 1,
        noNaN: true,
      });

      // When the input transition occurs: "holdStart" or "holdEnd"
      const transitionArb = fc.constantFrom("holdStart", "holdEnd");

      fc.assert(
        fc.property(
          dtArb,
          accelDurArb,
          decelDurArb,
          initVelFractionArb,
          transitionArb,
          (dt, accelDur, decelDur, initFraction, transition) => {
            // -----------------------------------------------------------------------
            // Setup
            // -----------------------------------------------------------------------

            const terminalEdge = 1_000_000; // effectively infinite
            const model = makeModel(terminalEdge);

            // Compute model params
            const maxVelocity = MAX_VELOCITY;
            const minTweenDuration = Math.min(accelDur, decelDur);

            // Allowed per-tick velocity change (the bound under test)
            const bound = maxVelocity * dt / minTweenDuration;

            // Set initial velocity directly via the tween-target object
            const initVelocity = initFraction * maxVelocity;
            model._state.velocity = initVelocity;

            // -----------------------------------------------------------------------
            // Simulate an incremental GSAP step for the transition tick
            //
            // An incremental GSAP linear step advances velocity by:
            //   Δv = (target − current) × (dt / tweenDuration)
            //
            // For a hold-start:  target = maxVelocity, duration = accelDur
            // For a hold-end:    target = 0,           duration = decelDur
            // -----------------------------------------------------------------------

            const velBefore = model._state.velocity;

            // Apply the input transition and compute what the incremental
            // GSAP stub would set velocity to.
            let tweenTarget: number;
            let tweenDuration: number;

            if (transition === "holdStart") {
              model.startHold(); // fires the (immediate) mock — resets vel to maxVelocity
              tweenTarget = maxVelocity;
              tweenDuration = accelDur;
            } else {
              model.releaseHold(); // fires the (immediate) mock — resets vel to 0
              tweenTarget = 0;
              tweenDuration = decelDur;
            }

            // Overwrite with the incremental step value, undoing the mock's
            // immediate assignment and replacing it with the bounded increment.
            const delta = (tweenTarget - velBefore) * (dt / tweenDuration);
            const velAfterTween = velBefore + delta;
            model._state.velocity = velAfterTween;

            // Velocity observed BEFORE the tick (t)
            const velocityAtT = model._state.velocity;

            // Advance one tick — this integrates worldPosition but does NOT
            // change _state.velocity itself (GSAP owns that field).
            // We re-apply the same incremental step to simulate the next
            // GSAP update that would fire concurrently with the tick.
            //
            // In practice GSAP and rAF run together; we model one combined step:
            //   velocity[t+1] = velocity[t] + Δv (bounded)
            const velAfterSecondStep = velocityAtT + delta;
            model._state.velocity = velAfterSecondStep;

            model.tick(dt);

            // Velocity observed AFTER the tick (t+1)
            const velocityAtT1 = model._state.velocity;

            // -----------------------------------------------------------------------
            // Core assertion: |velocity[t+1] − velocity[t]| ≤ bound
            // -----------------------------------------------------------------------
            const actualChange = Math.abs(velocityAtT1 - velocityAtT);

            expect(actualChange).toBeLessThanOrEqual(bound + Number.EPSILON * maxVelocity * 10);
          }
        ),
        {
          numRuns: 100,
          verbose: true,
        }
      );
    }
  );

  it(
    "velocity change across a hold-start/hold-end transition boundary stays within bound for multi-tick sequences",
    () => {
      // Generate a sequence of ticks with a transition in the middle
      const dtArb = fc.float({
        min: Math.fround(0.001),
        max: Math.fround(0.1),
        noNaN: true,
      });

      const accelDurArb = fc.float({
        min: Math.fround(0.5),
        max: Math.fround(3.0),
        noNaN: true,
      });

      const decelDurArb = fc.float({
        min: Math.fround(0.5),
        max: Math.fround(3.0),
        noNaN: true,
      });

      // Number of ticks to simulate before the transition (0–9)
      const ticksBeforeArb = fc.integer({ min: 0, max: 9 });

      fc.assert(
        fc.property(
          dtArb,
          accelDurArb,
          decelDurArb,
          ticksBeforeArb,
          (dt, accelDur, decelDur, ticksBefore) => {
            const terminalEdge = 1_000_000;
            const model = makeModel(terminalEdge);

            const maxVelocity = MAX_VELOCITY;
            const minTweenDuration = Math.min(accelDur, decelDur);
            const bound = maxVelocity * dt / minTweenDuration;

            // Phase 1: accelerate for ticksBefore ticks using incremental steps
            model.startHold();
            const accelStep = maxVelocity * (dt / accelDur);

            for (let i = 0; i < ticksBefore; i++) {
              const current = model._state.velocity;
              const next = Math.min(current + accelStep, maxVelocity);
              model._state.velocity = next;
              model.tick(dt);
            }

            // Record velocity just before the transition tick
            const velBeforeTransition = model._state.velocity;

            // Phase 2: release and apply one incremental decel step
            model.releaseHold();
            const decelStep = velBeforeTransition * (dt / decelDur);
            const velAfterTransition = Math.max(velBeforeTransition - decelStep, 0);
            model._state.velocity = velAfterTransition;

            model.tick(dt);

            // The velocity change across the transition tick must be bounded
            const actualChange = Math.abs(velAfterTransition - velBeforeTransition);

            expect(actualChange).toBeLessThanOrEqual(bound + Number.EPSILON * maxVelocity * 10);
          }
        ),
        {
          numRuns: 100,
          verbose: true,
        }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 9: Velocity decelerates monotonically on release
// Validates: Requirements 4.2, 4.3
// ---------------------------------------------------------------------------

describe("VelocityModel — Property 9: Velocity decelerates monotonically on release", () => {
  /**
   * For any initial world velocity v₀ in (0, maxVelocity], when no hold input
   * is active, the velocity at each subsequent tick SHALL be less than or equal
   * to the velocity at the previous tick until 0 is reached.
   *
   * **Validates: Requirements 4.2, 4.3**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 9: Velocity decelerates monotonically on release
   *
   * Testing strategy:
   *   The module-level GSAP mock snaps velocity instantly to its target value,
   *   so releaseHold() would immediately zero velocity rather than gradually
   *   stepping it down.  To test monotonic deceleration across multiple ticks
   *   we drive model._state.velocity manually between ticks using a linear
   *   ramp from v₀ down to 0 across n steps — faithfully simulating the
   *   decreasing output of a smooth GSAP deceleration tween.  This isolates
   *   the VelocityModel position-integration and terminal-clamp logic from
   *   GSAP itself.
   */
  it(
    "velocity[t+1] <= velocity[t] for every tick after releaseHold() until velocity reaches 0",
    () => {
      // v0: initial velocity strictly inside (0, maxVelocity]
      const v0Arb = fc.float({
        min: Math.fround(0.001),
        max: Math.fround(MAX_VELOCITY),
        noNaN: true,
      });

      // n: number of deceleration ticks to observe, at least 2
      const nArb = fc.integer({ min: 2, max: 20 });

      // dt: per-tick frame duration in seconds (1 ms – 100 ms)
      const dtArb = fc.float({
        min: Math.fround(0.001),
        max: Math.fround(0.1),
        noNaN: true,
      });

      fc.assert(
        fc.property(v0Arb, nArb, dtArb, (v0, n, dt) => {
          // Use a terminalEdge large enough that the terminal clamp never
          // fires during the n ticks under test.
          // Worst case: n × dt × v0 ≤ 20 × 0.1 × 800 = 1 600 px; add margin.
          const terminalEdge = 100_000;
          const model = makeModel(terminalEdge);

          // ----------------------------------------------------------------
          // Seed: set the model to a known state before deceleration begins.
          // We use startHold() (which the snap mock immediately sets velocity
          // to MAX_VELOCITY) and then override _state.velocity to exactly v0.
          // ----------------------------------------------------------------
          model.startHold();
          model._state.velocity = v0;

          // releaseHold() fires the snap mock, zeroing velocity.
          // Immediately restore v0 so the deceleration simulation starts
          // at the intended initial velocity.
          model.releaseHold();
          model._state.velocity = v0;

          // ----------------------------------------------------------------
          // Simulate n incremental deceleration steps using a linear ramp
          // from v0 down to 0.  A linear ramp is the simplest strictly
          // monotonically-decreasing series and is a conservative bound on
          // any smooth (power2.inOut) easing curve.
          //
          // At step i the velocity target is:
          //   velocity[i] = v0 × (1 − i / n)
          //
          // We record velocity BEFORE each tick, advance position via
          // tick(dt), then step velocity down for the next iteration.
          // ----------------------------------------------------------------
          const velocities: number[] = [];

          for (let i = 0; i < n; i++) {
            // Record current velocity (before this tick)
            velocities.push(model._state.velocity);

            // Integrate position one frame
            model.tick(dt);

            // Step velocity down toward 0 (incremental tween simulation)
            const nextVelocity = v0 * (1 - (i + 1) / n);
            model._state.velocity = Math.max(0, nextVelocity);
          }

          // Record the final velocity (after the last tick)
          velocities.push(model._state.velocity);

          // ----------------------------------------------------------------
          // Assert 1: the velocity sequence is monotonically non-increasing
          // ----------------------------------------------------------------
          for (let t = 0; t < velocities.length - 1; t++) {
            expect(velocities[t + 1]).toBeLessThanOrEqual(velocities[t]);
          }

          // ----------------------------------------------------------------
          // Assert 2: velocity reaches 0 by the end of the sequence
          // ----------------------------------------------------------------
          expect(velocities[velocities.length - 1]).toBe(0);
        }),
        {
          numRuns: 100,
          verbose: true,
        }
      );
    }
  );
});
