/**
 * Property-based tests for MyrioramaSequencer.
 *
 * Feature: illustrated-interactive-journey
 *
 * Testing strategy:
 *   MyrioramaSequencer is tested without PIXI — the `instanceFactory` and
 *   `loadSegment` callbacks are lightweight stubs. PIXI containers are
 *   replaced with plain objects tracking `destroy` calls.
 *
 *   All async operations are awaited via a `flushPromises()` helper so that
 *   property assertions run against fully-settled state.
 *
 * Properties covered in this file:
 *   Property 3 — Edge-match invariant            (Requirements 2.1, 2.4)
 *   Property 4 — Off-screen segments are recycled (Requirements 2.2)
 *   Property 5 — Lookahead triggers segment load  (Requirements 2.3)
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import {
  MyrioramaSequencer,
  type SegmentInstanceFactory,
  type LoadSegmentCallback,
} from "@/modules/MyrioramaSequencer";
import type { SegmentDescriptor, SegmentInstance } from "@/types/journey";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drain the microtask queue so that all pending Promises settle. */
async function flushPromises(): Promise<void> {
  // Two rounds of yielding: one for the async load callbacks, one for their
  // `.then()` continuations inside _loadWithRetry / _triggerLookaheadLoads.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Build a minimal SegmentDescriptor with a given widthPx. */
function makeDescriptor(id: string, index: number, widthPx: number): SegmentDescriptor {
  return {
    id,
    index,
    role: index === 0 ? "departure" : "intermediate",
    widthPx,
    layers: { background: "", midground: "", foreground: "" },
    audioTrack: "",
    edgeMatchOffsetLeft: 0,
    edgeMatchOffsetRight: 0,
  };
}

/**
 * A stub SegmentInstance factory that produces plain objects — no PIXI
 * dependency required.  The `container.destroy` method is tracked so tests
 * can assert on it.
 */
function makeInstanceFactory(): SegmentInstanceFactory {
  return (descriptor) => ({
    descriptor,
    container: { destroy: vi.fn() } as unknown as SegmentInstance["container"],
    bgSprite: {} as SegmentInstance["bgSprite"],
    mgSprite: {} as SegmentInstance["mgSprite"],
    fgSprite: {} as SegmentInstance["fgSprite"],
    worldX: 0,
    loaded: false,
    recycled: false,
  });
}

/**
 * A load callback that resolves immediately (simulates fast asset load).
 */
const instantLoad: LoadSegmentCallback = (_instance) => Promise.resolve();

// ---------------------------------------------------------------------------
// Property 3: Edge-match invariant
// Validates: Requirements 2.1, 2.4
// ---------------------------------------------------------------------------

describe("MyrioramaSequencer — Property 3: Edge-match invariant", () => {
  /**
   * For any array of n SegmentDescriptors with arbitrary widthPx values,
   * after sequencer construction:
   *   segments[i+1].worldX === segments[i].worldX + segments[i].descriptor.widthPx
   * for all i in [0, n-2].
   *
   * **Validates: Requirements 2.1, 2.4**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 3: Edge-match invariant
   */
  it(
    "segments[i+1].worldX === segments[i].worldX + segments[i].descriptor.widthPx for all i",
    () => {
      // Generate between 1 and 8 segments (matching the 5–8 spec, but 1–8 for
      // edge-case coverage), each with an arbitrary widthPx in [1, 10 000].
      const descriptorsArb = fc.array(
        fc.integer({ min: 1, max: 10_000 }),
        { minLength: 1, maxLength: 8 }
      ).map((widths) =>
        widths.map((w, i) => makeDescriptor(`seg-${i.toString().padStart(2, "0")}`, i, w))
      );

      fc.assert(
        fc.property(descriptorsArb, (descriptors) => {
          const sequencer = new MyrioramaSequencer({
            descriptors,
            viewportWidth: 1280,
            instanceFactory: makeInstanceFactory(),
            loadSegment: instantLoad,
          });

          const segments = sequencer.activeSegments;

          // Check the edge-match invariant for every consecutive pair
          for (let i = 0; i < segments.length - 1; i++) {
            const expected = segments[i].worldX + segments[i].descriptor.widthPx;
            expect(segments[i + 1].worldX).toBe(expected);
          }

          // Additionally verify segment[0].worldX === 0
          expect(segments[0].worldX).toBe(0);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it("totalWorldWidth equals the sum of all widthPx values", () => {
    const descriptorsArb = fc.array(
      fc.integer({ min: 1, max: 10_000 }),
      { minLength: 1, maxLength: 8 }
    ).map((widths) =>
      widths.map((w, i) => makeDescriptor(`seg-${i}`, i, w))
    );

    fc.assert(
      fc.property(descriptorsArb, (descriptors) => {
        const sequencer = new MyrioramaSequencer({
          descriptors,
          viewportWidth: 1280,
          instanceFactory: makeInstanceFactory(),
          loadSegment: instantLoad,
        });

        const expectedTotal = descriptors.reduce((sum, d) => sum + d.widthPx, 0);
        expect(sequencer.totalWorldWidth).toBe(expectedTotal);
      }),
      { numRuns: 200, verbose: true }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Off-screen segments are recycled
// Validates: Requirements 2.2
// ---------------------------------------------------------------------------

describe("MyrioramaSequencer — Property 4: Off-screen segments are recycled", () => {
  /**
   * For any loaded segment whose right edge (worldX + widthPx) is less than
   * worldPosition − viewportWidth, after calling update(), the segment SHALL
   * be marked recycled and container.destroy shall have been called.
   *
   * **Validates: Requirements 2.2**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 4: Off-screen segments are recycled
   */
  it(
    "marks loaded segments as recycled and calls container.destroy when fully off-screen left",
    () => {
      // Generate 1–4 segments. For each we pick a widthPx in [100, 1000].
      // We then choose a worldPosition and viewportWidth such that at least
      // one segment satisfies the recycle condition:
      //   segment.worldX + segment.widthPx < worldPosition - viewportWidth
      const widthArb = fc.integer({ min: 100, max: 1_000 });
      const viewportWidthArb = fc.integer({ min: 200, max: 1_280 });
      const descriptorsArb = fc
        .array(widthArb, { minLength: 1, maxLength: 4 })
        .map((widths) =>
          widths.map((w, i) => makeDescriptor(`seg-${i}`, i, w))
        );

      fc.assert(
        fc.property(
          descriptorsArb,
          viewportWidthArb,
          (descriptors, viewportWidth) => {
            // Compute cumulative worldX values for the test
            const worldXByIndex: number[] = [];
            let cursor = 0;
            for (const d of descriptors) {
              worldXByIndex.push(cursor);
              cursor += d.widthPx;
            }

            // Set worldPosition so that the first segment is fully off-screen:
            //   recycleThreshold = worldPosition - viewportWidth
            //   must be > seg[0].worldX + seg[0].widthPx
            // → worldPosition > seg[0].widthPx + viewportWidth
            const seg0Width = descriptors[0].widthPx;
            const worldPosition = seg0Width + viewportWidth + 1;

            // Build sequencer with pre-loaded first segment
            const destroySpy = vi.fn();
            const instanceFactory: SegmentInstanceFactory = (descriptor) => ({
              descriptor,
              container: { destroy: destroySpy } as unknown as SegmentInstance["container"],
              bgSprite: {} as SegmentInstance["bgSprite"],
              mgSprite: {} as SegmentInstance["mgSprite"],
              fgSprite: {} as SegmentInstance["fgSprite"],
              worldX: 0,
              loaded: false,
              recycled: false,
            });

            const sequencer = new MyrioramaSequencer({
              descriptors,
              viewportWidth,
              instanceFactory,
              loadSegment: instantLoad,
            });

            // Mark the first segment as loaded so the recycler can act on it.
            // We reach into activeSegments (which returns the internal array
            // contents) and mutate directly — as the real loader would.
            const firstSegment = sequencer.activeSegments[0];
            firstSegment.loaded = true;

            sequencer.update(worldPosition);

            // The first segment must now be recycled
            expect(firstSegment.recycled).toBe(true);
            expect(destroySpy).toHaveBeenCalledWith({ children: true });
          }
        ),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "does not recycle loaded segments that are NOT fully off-screen",
    () => {
      // A segment is NOT fully off-screen when its right edge is still within
      // or beyond the recycle threshold. We test three sub-cases:
      //   a) right edge exactly equals the threshold (boundary — NOT recycled)
      //   b) right edge is inside the viewport (visible — NOT recycled)
      //   c) worldPosition is 0 (nothing can be off-screen)
      const viewportWidth = 1_280;
      const segWidth = 2_400;

      const descriptors = [makeDescriptor("seg-0", 0, segWidth)];

      // ── case a: boundary — right edge === worldPosition − viewportWidth ──
      // recycle requires STRICTLY less-than, so this must NOT be recycled
      {
        const destroySpy = vi.fn();
        const instanceFactory: SegmentInstanceFactory = (descriptor) => ({
          descriptor,
          container: { destroy: destroySpy } as unknown as SegmentInstance["container"],
          bgSprite: {} as SegmentInstance["bgSprite"],
          mgSprite: {} as SegmentInstance["mgSprite"],
          fgSprite: {} as SegmentInstance["fgSprite"],
          worldX: 0,
          loaded: false,
          recycled: false,
        });

        const sequencer = new MyrioramaSequencer({
          descriptors,
          viewportWidth,
          instanceFactory,
          loadSegment: instantLoad,
        });

        const segment = sequencer.activeSegments[0];
        segment.loaded = true;

        // worldPosition such that rightEdge === recycleThreshold (boundary)
        // rightEdge = segWidth = 2400
        // recycleThreshold = worldPosition - viewportWidth
        // 2400 === worldPosition - 1280 → worldPosition = 3680
        sequencer.update(3_680);

        expect(segment.recycled).toBe(false);
        expect(destroySpy).not.toHaveBeenCalled();
      }

      // ── case b: segment still visible (worldPosition = 0) ──
      {
        const destroySpy = vi.fn();
        const instanceFactory: SegmentInstanceFactory = (descriptor) => ({
          descriptor,
          container: { destroy: destroySpy } as unknown as SegmentInstance["container"],
          bgSprite: {} as SegmentInstance["bgSprite"],
          mgSprite: {} as SegmentInstance["mgSprite"],
          fgSprite: {} as SegmentInstance["fgSprite"],
          worldX: 0,
          loaded: false,
          recycled: false,
        });

        const sequencer = new MyrioramaSequencer({
          descriptors,
          viewportWidth,
          instanceFactory,
          loadSegment: instantLoad,
        });

        const segment = sequencer.activeSegments[0];
        segment.loaded = true;

        sequencer.update(0);

        expect(segment.recycled).toBe(false);
        expect(destroySpy).not.toHaveBeenCalled();
      }
    }
  );

  it(
    "does not attempt to recycle unloaded segments (no container to destroy)",
    () => {
      // An unloaded segment has no live container. Calling destroy on it
      // would crash. The recycler must skip unloaded segments entirely.
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1_000 }),  // segWidth
          fc.integer({ min: 200, max: 1_280 }),   // viewportWidth
          (segWidth, viewportWidth) => {
            const destroySpy = vi.fn();
            const instanceFactory: SegmentInstanceFactory = (descriptor) => ({
              descriptor,
              container: { destroy: destroySpy } as unknown as SegmentInstance["container"],
              bgSprite: {} as SegmentInstance["bgSprite"],
              mgSprite: {} as SegmentInstance["mgSprite"],
              fgSprite: {} as SegmentInstance["fgSprite"],
              worldX: 0,
              loaded: false,   // ← deliberately NOT loaded
              recycled: false,
            });

            const descriptors = [makeDescriptor("seg-0", 0, segWidth)];

            const sequencer = new MyrioramaSequencer({
              descriptors,
              viewportWidth,
              instanceFactory,
              loadSegment: instantLoad,
            });

            // Use a worldPosition that would normally trigger recycle
            const worldPosition = segWidth + viewportWidth + 1;
            sequencer.update(worldPosition);

            // Unloaded segment must NOT be recycled or have destroy called
            const segment = sequencer.activeSegments[0];
            expect(segment.recycled).toBe(false);
            expect(destroySpy).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100, verbose: true }
      );
    }
  );

  it(
    "does not recycle an already-recycled segment a second time",
    () => {
      const destroySpy = vi.fn();
      const instanceFactory: SegmentInstanceFactory = (descriptor) => ({
        descriptor,
        container: { destroy: destroySpy } as unknown as SegmentInstance["container"],
        bgSprite: {} as SegmentInstance["bgSprite"],
        mgSprite: {} as SegmentInstance["mgSprite"],
        fgSprite: {} as SegmentInstance["fgSprite"],
        worldX: 0,
        loaded: false,
        recycled: false,
      });

      const descriptors = [makeDescriptor("seg-0", 0, 800)];
      const viewportWidth = 1_280;

      const sequencer = new MyrioramaSequencer({
        descriptors,
        viewportWidth,
        instanceFactory,
        loadSegment: instantLoad,
      });

      const segment = sequencer.activeSegments[0];
      segment.loaded = true;

      // First update — triggers recycle
      const worldPosition = 800 + viewportWidth + 1;
      sequencer.update(worldPosition);
      expect(segment.recycled).toBe(true);
      expect(destroySpy).toHaveBeenCalledTimes(1);

      // Second update — segment is already recycled; destroy must not be called again
      sequencer.update(worldPosition + 100);
      expect(destroySpy).toHaveBeenCalledTimes(1);
    }
  );
});

// ---------------------------------------------------------------------------
// Property 5: Lookahead triggers segment load
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------

describe("MyrioramaSequencer — Property 5: Lookahead triggers segment load", () => {
  /**
   * For any unloaded segment S and rider worldPosition such that
   *   worldPosition + viewportWidth + S.descriptor.widthPx >= S.worldX
   * the sequencer SHALL have initiated a load for S before S.worldX enters
   * the viewport.
   *
   * **Validates: Requirements 2.3**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 5: Lookahead triggers segment load
   */
  it(
    "calls loadSegment for every segment that satisfies the lookahead condition after update()",
    async () => {
      // Generate 2–4 segments with widths in [200, 2000].
      // viewportWidth also varies to exercise the condition boundary.
      const widthArb = fc.integer({ min: 200, max: 2_000 });
      const viewportWidthArb = fc.integer({ min: 400, max: 1_920 });
      const descriptorsArb = fc.array(widthArb, { minLength: 2, maxLength: 4 }).map(
        (widths) => widths.map((w, i) => makeDescriptor(`seg-${i}`, i, w))
      );

      await fc.assert(
        fc.asyncProperty(
          descriptorsArb,
          viewportWidthArb,
          async (descriptors, viewportWidth) => {

            // Track which segments had loadSegment called
            const loadCalled = new Set<string>();
            const loadFn: LoadSegmentCallback = (instance) => {
              loadCalled.add(instance.descriptor.id);
              instance.loaded = true;
              return Promise.resolve();
            };

            const sequencer = new MyrioramaSequencer({
              descriptors,
              viewportWidth,
              instanceFactory: makeInstanceFactory(),
              loadSegment: loadFn,
            });

            // Compute which segments satisfy the lookahead condition at
            // worldPosition = 0. A segment satisfies it when:
            //   0 + viewportWidth + segment.descriptor.widthPx >= segment.worldX
            const segments = sequencer.activeSegments;
            const shouldBeLoaded = new Set(
              segments
                .filter(
                  (s) => 0 + viewportWidth + s.descriptor.widthPx >= s.worldX
                )
                .map((s) => s.descriptor.id)
            );

            // Trigger the update with worldPosition = 0
            sequencer.update(0);
            await flushPromises();

            // Every segment that satisfies the condition must have been loaded
            for (const id of shouldBeLoaded) {
              expect(loadCalled.has(id)).toBe(true);
            }
          }
        ),
        { numRuns: 100, verbose: true }
      );
    }
  );

  it(
    "does not load segments that do NOT satisfy the lookahead condition",
    async () => {
      // Use a small viewport and position the rider far before segment 1
      // so that segment 1's lookahead condition is NOT yet met.
      //
      // Segment layout (fixed): [seg0: 0–800] [seg1: 800–1600]
      // viewportWidth = 100, worldPosition = 0
      // Condition for seg1: 0 + 100 + 800 = 900 >= 800 → TRUE (seg1 IS loaded)
      //
      // To make segment 1 NOT load we need:
      //   worldPosition + viewportWidth + seg1.widthPx < seg1.worldX
      //   i.e.  0 + 100 + 800 = 900 < 800 → false (always loads)
      //
      // We instead use 3 segments and check the last one:
      // [seg0: 0–800] [seg1: 800–1600] [seg2: 1600–2400]
      // viewportWidth = 100, worldPosition = 0
      // Condition for seg2: 0 + 100 + 800 = 900 >= 1600 → FALSE
      // → seg2 should NOT be loaded yet.

      const loadCalled = new Set<string>();
      const loadFn: LoadSegmentCallback = (instance) => {
        loadCalled.add(instance.descriptor.id);
        instance.loaded = true;
        return Promise.resolve();
      };

      const descriptors = [
        makeDescriptor("seg-0", 0, 800),
        makeDescriptor("seg-1", 1, 800),
        makeDescriptor("seg-2", 2, 800),
      ];

      const sequencer = new MyrioramaSequencer({
        descriptors,
        viewportWidth: 100,
        instanceFactory: makeInstanceFactory(),
        loadSegment: loadFn,
      });

      sequencer.update(0);
      await flushPromises();

      // seg-2 should NOT have been loaded (condition: 0 + 100 + 800 = 900 < 1600)
      expect(loadCalled.has("seg-2")).toBe(false);
    }
  );

  it(
    "marks load as initiated before the async call to prevent duplicate loads",
    async () => {
      // Call update() twice in rapid succession (no await between them).
      // The load for each segment should only be called once, not twice.
      let loadCallCount = 0;
      const loadFn: LoadSegmentCallback = (_instance) => {
        loadCallCount++;
        _instance.loaded = true;
        return new Promise((resolve) => setTimeout(resolve, 10));
      };

      const descriptors = [makeDescriptor("seg-0", 0, 800)];

      const sequencer = new MyrioramaSequencer({
        descriptors,
        viewportWidth: 1280,
        instanceFactory: makeInstanceFactory(),
        loadSegment: loadFn,
      });

      // Two rapid updates — the first should initiate the load; the second
      // should see _loadInitiated already has the index and skip.
      sequencer.update(0);
      sequencer.update(0);
      await flushPromises();

      expect(loadCallCount).toBe(1);
    }
  );

  it(
    "retries once on load failure and marks segment as loaded on retry success",
    async () => {
      let callCount = 0;
      const loadFn: LoadSegmentCallback = (instance) => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("first attempt fail"));
        instance.loaded = true;
        return Promise.resolve();
      };

      const descriptors = [makeDescriptor("seg-0", 0, 800)];

      const sequencer = new MyrioramaSequencer({
        descriptors,
        viewportWidth: 1280,
        instanceFactory: makeInstanceFactory(),
        loadSegment: loadFn,
      });

      sequencer.update(0);
      await flushPromises();

      expect(callCount).toBe(2);
      // After successful retry the segment is loaded
      expect(sequencer.activeSegments[0].loaded).toBe(true);
    }
  );

  it(
    "logs a warning and skips segment after two consecutive load failures",
    async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const loadFn: LoadSegmentCallback = (_instance) =>
        Promise.reject(new Error("always fails"));

      const descriptors = [makeDescriptor("seg-0", 0, 800)];

      const sequencer = new MyrioramaSequencer({
        descriptors,
        viewportWidth: 1280,
        instanceFactory: makeInstanceFactory(),
        loadSegment: loadFn,
      });

      sequencer.update(0);
      await flushPromises();

      // console.warn should have been called once (second failure = skip + warn)
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain("seg-0");

      // Segment must not be marked loaded
      expect(sequencer.activeSegments[0].loaded).toBe(false);

      warnSpy.mockRestore();
    }
  );

  it(
    "does not re-trigger load for already-initiated segments after forceReloadAll is not called",
    async () => {
      let callCount = 0;
      const loadFn: LoadSegmentCallback = (instance) => {
        callCount++;
        instance.loaded = true;
        return Promise.resolve();
      };

      const descriptors = [makeDescriptor("seg-0", 0, 800)];

      const sequencer = new MyrioramaSequencer({
        descriptors,
        viewportWidth: 1280,
        instanceFactory: makeInstanceFactory(),
        loadSegment: loadFn,
      });

      sequencer.update(0);
      await flushPromises();
      expect(callCount).toBe(1);

      // Additional updates should not retrigger load
      sequencer.update(0);
      sequencer.update(100);
      await flushPromises();

      expect(callCount).toBe(1);
    }
  );
});
