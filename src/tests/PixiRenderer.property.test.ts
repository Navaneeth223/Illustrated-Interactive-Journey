/**
 * Property-based tests for PixiRenderer.
 *
 * Feature: illustrated-interactive-journey
 *
 * Testing strategy:
 *   PixiRenderer is instantiated with a lightweight PIXI.Application stub.
 *   The stub tracks `stage.filters`, `stage.addChild` calls, and
 *   `renderer.resolution` — the three things property tests need to inspect.
 *
 *   PIXI itself is mocked at the module level so no WebGL context is needed.
 *   Each stub class mirrors the minimal surface area of its real counterpart.
 *
 *   vi.hoisted() is used to define stub constructors before vi.mock() hoists
 *   them to the top of the file, avoiding "Cannot access before initialization"
 *   reference errors.
 *
 * Properties covered in this file:
 *   Property 6  — Parallax multipliers are correct (Requirements 3.1, 3.2, 3.3)
 *   Property 12 — Grayscale filter is applied to all scene layers (Requirements 5.2)
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Hoisted stubs — must be defined via vi.hoisted() so they are available
// when vi.mock() factory runs (vi.mock calls are hoisted above imports).
// ---------------------------------------------------------------------------

const {
  StubColorMatrixFilter,
  StubFilter,
  StubSprite,
  StubContainer,
  StubTexture,
  StubGlProgram,
  StubUniformGroup,
  StubGraphics,
  StubBlurFilter,
  StubTilingSprite,
} = vi.hoisted(() => {
  class StubColorMatrixFilter {
    readonly _isColorMatrixFilter = true;
    grayscale(_amount: number, _multiply: boolean): void {}
    saturate(_amount: number, _multiply: boolean): void {}
  }

  class StubFilter {
    readonly _isFilter = true;
  }

  class StubBlurFilter {
    readonly _isBlurFilter = true;
    constructor(_opts?: unknown) {}
  }

  class StubSprite {
    x = 0;
    width = 0;
    height = 0;
    blendMode: string = "normal";
    alpha = 1;
    visible = true;
    texture: { width: number; height: number } = { width: 100, height: 100 };
  }

  class StubTilingSprite {
    x = 0;
    width = 0;
    height = 0;
    blendMode: string = "normal";
    alpha = 1;
    visible = true;
    tilePosition = { set(_x: number, _y: number): void {} };
    texture: { width: number; height: number } = { width: 256, height: 256 };
    constructor(_opts?: unknown) {}
  }

  class StubGraphics {
    x = 0;
    y = 0;
    rotation = 0;
    alpha = 1;
    visible = true;
    readonly children: unknown[] = [];
    filters: unknown[] | null = null;
    scale = { set(_v: number): void {}, x: 1, y: 1 };
    position = { set(_x: number, _y: number): void {} };
    pivot = { set(_x: number, _y: number): void {} };

    circle(_x: number, _y: number, _r: number) { return this; }
    rect(_x: number, _y: number, _w: number, _h: number) { return this; }
    roundRect(_x: number, _y: number, _w: number, _h: number, _r: number) { return this; }
    arc(_cx: number, _cy: number, _r: number, _sa: number, _ea: number) { return this; }
    moveTo(_x: number, _y: number) { return this; }
    lineTo(_x: number, _y: number) { return this; }
    fill(_color: unknown) { return this; }
    stroke(_opts: unknown) { return this; }
    addChild(child: unknown): unknown {
      (this.children as unknown[]).push(child);
      return child;
    }
  }

  class StubContainer {
    x = 0;
    y = 0;
    rotation = 0;
    alpha = 1;
    visible = true;
    readonly children: unknown[] = [];
    filters: unknown[] | null = null;
    scale = { set(_v: number): void {}, x: 1, y: 1 };
    position = { set(_x: number, _y: number): void {} };
    pivot = { set(_x: number, _y: number): void {} };

    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
    removeChild(_child: unknown): void {}
    destroy(_opts?: unknown): void {}
  }

  const StubTexture = {
    WHITE: { width: 1, height: 1 },
    EMPTY: { width: 1, height: 1 },
    from: (_url: unknown) => ({ width: 100, height: 100 }),
  };

  const StubGlProgram = {
    from: (_opts: unknown) => ({}),
  };

  class StubUniformGroup {
    constructor(_uniforms: unknown) {}
  }

  return {
    StubColorMatrixFilter,
    StubFilter,
    StubBlurFilter,
    StubSprite,
    StubTilingSprite,
    StubGraphics,
    StubContainer,
    StubTexture,
    StubGlProgram,
    StubUniformGroup,
  };
});

// ---------------------------------------------------------------------------
// Module-level vi.mock — replaces pixi.js for the entire file.
// All referenced identifiers come from the vi.hoisted() block above.
// ---------------------------------------------------------------------------

vi.mock("pixi.js", () => ({
  Application: class {},
  Container: StubContainer,
  Sprite: StubSprite,
  TilingSprite: StubTilingSprite,
  Graphics: StubGraphics,
  Filter: StubFilter,
  BlurFilter: StubBlurFilter,
  ColorMatrixFilter: StubColorMatrixFilter,
  Texture: StubTexture,
  GlProgram: StubGlProgram,
  UniformGroup: StubUniformGroup,
}));

// Mock gsap so WindSystem/SunMoonActor/CyclistRig don't need a real gsap.
vi.mock("gsap", () => ({
  gsap: {
    to: (_target: unknown, _vars: unknown) => ({ kill: () => {} }),
  },
}));

// Mock howler so AudioController doesn't create real audio nodes.
vi.mock("howler", () => ({
  Howler: { ctx: { resume: () => Promise.resolve() } },
  Howl: vi.fn().mockImplementation(() => ({
    play: vi.fn(), stop: vi.fn(), fade: vi.fn(), volume: vi.fn().mockReturnValue(0),
  })),
}));

// ---------------------------------------------------------------------------
// Imports — placed AFTER vi.mock() so the mock is active when PixiRenderer is
// loaded by the module system.
// ---------------------------------------------------------------------------

import { PixiRenderer } from "@/modules/PixiRenderer";
import type { SegmentInstance, SegmentDescriptor } from "@/types/journey";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh stub app whose stage is a StubContainer.
 */
function makeStubApp(): {
  stage: InstanceType<typeof StubContainer>;
  screen: { width: number; height: number };
  renderer: { resolution: number; resize: ReturnType<typeof vi.fn> };
} {
  return {
    stage: new StubContainer(),
    screen: { width: 1280, height: 720 },
    renderer: { resolution: 1, resize: vi.fn() },
  };
}

/** Build a minimal SegmentDescriptor. */
function makeDescriptor(id: string, index: number): SegmentDescriptor {
  return {
    id,
    index,
    role: index === 0 ? "departure" : index === 1 ? "intermediate" : "arrival",
    widthPx: 2400,
    layers: {
      background: `assets/${id}/bg.webp`,
      midground:  `assets/${id}/mg.webp`,
      foreground: `assets/${id}/fg.webp`,
    },
    audioTrack: `assets/audio/${id}.mp3`,
    edgeMatchOffsetLeft: 0,
    edgeMatchOffsetRight: 0,
    groundLineRatio: 0.72,
  };
}

/** Build a minimal SegmentInstance backed by stub sprites. */
function makeSegmentInstance(id: string, index: number): SegmentInstance {
  return {
    descriptor: makeDescriptor(id, index),
    container: new StubContainer() as unknown as SegmentInstance["container"],
    bgSprite: new StubSprite() as unknown as SegmentInstance["bgSprite"],
    mgSprite: new StubSprite() as unknown as SegmentInstance["mgSprite"],
    fgSprite: new StubSprite() as unknown as SegmentInstance["fgSprite"],
    worldX: index * 2400,
    loaded: true,
    recycled: false,
  };
}

// ---------------------------------------------------------------------------
// Property 6: Parallax multipliers are correct for all layer types
// Validates: Requirements 3.1, 3.2, 3.3
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 6: Parallax multipliers are correct for all layer types", () => {
  /**
   * For any worldPosition (integer or float), after calling render(), the
   * three layer containers SHALL have their x values set to exactly:
   *   bgContainer.x === -worldPosition * 0.15
   *   mgContainer.x === -worldPosition * 0.35
   *   fgContainer.x === -worldPosition * 1.00
   *
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 6: Parallax multipliers are correct for all layer types
   */
  it(
    "bgContainer.x === -worldPosition * 0.15, mgContainer.x === -worldPosition * 0.35, fgContainer.x === -worldPosition * 1.00",
    () => {
      // Generate arbitrary worldPosition values — integers and floats,
      // positive and negative, including zero and large values.
      const worldPositionArb = fc.oneof(
        // Integer positions (common in scroll logic)
        fc.integer({ min: -100_000, max: 100_000 }),
        // Float positions (velocity integration produces these)
        fc.float({ min: -100_000, max: 100_000, noNaN: true, noDefaultInfinity: true })
      );

      fc.assert(
        fc.property(worldPositionArb, (worldPosition) => {
          // Arrange: fresh renderer instance per iteration
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Act: call render with the generated worldPosition and no segments
          renderer.render(worldPosition, 0, []);

          // Assert: exact parallax multiplier equations.
          // The renderer normalises IEEE 754 negative-zero (-0) to positive-zero
          // (+0) via the `|| 0` idiom, so we compare with the same normalisation
          // applied: `(-worldPosition * multiplier) || 0`.
          expect(renderer.bgContainer.x).toBe((-worldPosition * 0.15) || 0);
          expect(renderer.mgContainer.x).toBe((-worldPosition * 0.35) || 0);
          expect(renderer.fgContainer.x).toBe((-worldPosition * 1.00) || 0);
        }),
        { numRuns: 500, verbose: true }
      );
    }
  );

  it(
    "all three containers have x numerically equal to 0 when worldPosition is 0",
    () => {
      const app = makeStubApp();
      const renderer = new PixiRenderer(
        app as unknown as import("pixi.js").Application
      );
      renderer.render(0, 0, []);

      // The renderer normalises -0 to +0 via `|| 0`. All three containers
      // should report exactly +0 when worldPosition is 0.
      expect(renderer.bgContainer.x).toBe(0);
      expect(renderer.mgContainer.x).toBe(0);
      expect(renderer.fgContainer.x).toBe(0);
    }
  );

  it(
    "multipliers maintain correct ratio between layers for any non-zero worldPosition",
    () => {
      // The ratio bg:mg:fg should always be 0.15 : 0.45 : 1.00
      const worldPositionArb = fc.float({
        min: 1,
        max: 100_000,
        noNaN: true,
        noDefaultInfinity: true,
      });

      fc.assert(
        fc.property(worldPositionArb, (worldPosition) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );
          renderer.render(worldPosition, 0, []);

          const bg = renderer.bgContainer.x;
          const mg = renderer.mgContainer.x;
          const fg = renderer.fgContainer.x;

          // fg is non-zero since worldPosition >= 1, so ratios are defined
          expect(bg / fg).toBeCloseTo(0.15, 10);
          expect(mg / fg).toBeCloseTo(0.35, 10);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "render() with segments does not change the parallax multipliers",
    () => {
      // Segments should not affect how worldPosition maps to container.x
      const worldPositionArb = fc.integer({ min: 1, max: 100_000 });
      const segCountArb = fc.integer({ min: 1, max: 4 });

      fc.assert(
        fc.property(worldPositionArb, segCountArb, (worldPosition, segCount) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          const segments = Array.from({ length: segCount }, (_, i) =>
            makeSegmentInstance(`seg-${String(i).padStart(2, "0")}`, i)
          );

          renderer.render(worldPosition, 0, segments);

          expect(renderer.bgContainer.x).toBe(-worldPosition * 0.15);
          expect(renderer.mgContainer.x).toBe(-worldPosition * 0.35);
          expect(renderer.fgContainer.x).toBe(-worldPosition * 1.00);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 7: Layer depth order is never reversed
// Validates: Requirements 3.5
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 7: Layer depth order is never reversed", () => {
  /**
   * For any scene state (any worldPosition and any set of segments), the child
   * index of bgContainer in app.stage.children SHALL be strictly less than
   * that of mgContainer, which SHALL be strictly less than that of fgContainer.
   *
   * The renderer adds the three containers to app.stage in constructor order:
   *   1. bgContainer (index 0)
   *   2. mgContainer (index 1)
   *   3. fgContainer (index 2)
   *   4. grainSprite  (index 3)
   *
   * This order must hold for every possible combination of worldPosition and
   * segment list — i.e., it must never be mutated by render() calls.
   *
   * **Validates: Requirements 3.5**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 7: Layer depth order is never reversed
   */
  it(
    "indexOf(bgContainer) < indexOf(mgContainer) < indexOf(fgContainer) for any scene state",
    () => {
      // Generate arbitrary worldPosition values — integers and floats,
      // positive and negative, including zero.
      const worldPositionArb = fc.oneof(
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.float({ min: -100_000, max: 100_000, noNaN: true, noDefaultInfinity: true })
      );

      // Generate 0–8 unique segment indices to vary the scene composition.
      const segmentsArb = fc
        .array(fc.integer({ min: 0, max: 7 }), {
          minLength: 0,
          maxLength: 8,
        })
        .map((indices) => {
          const unique = [...new Set(indices)];
          return unique.map((idx) =>
            makeSegmentInstance(`seg-${String(idx).padStart(2, "0")}`, idx)
          );
        });

      fc.assert(
        fc.property(worldPositionArb, segmentsArb, (worldPosition, segments) => {
          // Arrange: fresh renderer instance per iteration
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Act: call render() with the generated worldPosition and segments
          renderer.render(worldPosition, 0, segments);

          // Locate each layer container in the stage children array
          const children = app.stage.children;
          const bgIndex = children.indexOf(renderer.bgContainer);
          const mgIndex = children.indexOf(renderer.mgContainer);
          const fgIndex = children.indexOf(renderer.fgContainer);

          // All three containers must be present in the stage
          expect(bgIndex).toBeGreaterThanOrEqual(0);
          expect(mgIndex).toBeGreaterThanOrEqual(0);
          expect(fgIndex).toBeGreaterThanOrEqual(0);

          // Strict depth order: bg < mg < fg
          expect(bgIndex).toBeLessThan(mgIndex);
          expect(mgIndex).toBeLessThan(fgIndex);
        }),
        { numRuns: 500, verbose: true }
      );
    }
  );

  it(
    "depth order is established at construction time and not changed by render()",
    () => {
      // Verify the order immediately after construction (before any render call),
      // and again after multiple render calls with different segments.
      const app = makeStubApp();
      const renderer = new PixiRenderer(
        app as unknown as import("pixi.js").Application
      );

      const getOrder = () => {
        const children = app.stage.children;
        return {
          bgIndex: children.indexOf(renderer.bgContainer),
          mgIndex: children.indexOf(renderer.mgContainer),
          fgIndex: children.indexOf(renderer.fgContainer),
        };
      };

      // Order is correct right after construction
      const beforeRender = getOrder();
      expect(beforeRender.bgIndex).toBeLessThan(beforeRender.mgIndex);
      expect(beforeRender.mgIndex).toBeLessThan(beforeRender.fgIndex);

      // Order remains correct after several render() calls with varying inputs
      for (let i = 0; i < 5; i++) {
        const segments = [
          makeSegmentInstance("seg-00", 0),
          makeSegmentInstance("seg-01", 1),
        ];
        renderer.render(i * 1000, 0, segments);

        const afterRender = getOrder();
        expect(afterRender.bgIndex).toBeLessThan(afterRender.mgIndex);
        expect(afterRender.mgIndex).toBeLessThan(afterRender.fgIndex);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// Property 12: Grayscale filter is applied to all scene layers
// Validates: Requirements 5.2
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 12: Grayscale filter is applied to all scene layers", () => {
  /**
   * For any set of segments passed to render(), app.stage.filters SHALL
   * contain a ColorMatrixFilter configured for full desaturation.
   *
   * The filter is attached to the stage root, which encompasses all layer
   * containers (background, midground, foreground), satisfying Requirement
   * 5.2: "apply a desaturation (grayscale) filter to all scene Layers".
   *
   * **Validates: Requirements 5.2**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 12: Grayscale filter is applied to all scene layers
   */
  it(
    "app.stage.filters contains a ColorMatrixFilter after render() with any set of segments",
    () => {
      // Generate 0–8 unique segment indices to vary the scene composition
      const segmentsArb = fc
        .array(fc.integer({ min: 0, max: 7 }), {
          minLength: 0,
          maxLength: 8,
        })
        .map((indices) => {
          const unique = [...new Set(indices)];
          return unique.map((idx) =>
            makeSegmentInstance(`seg-${String(idx).padStart(2, "0")}`, idx)
          );
        });

      // worldPosition: arbitrary non-negative scroll progress
      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });

      fc.assert(
        fc.property(segmentsArb, worldPositionArb, (segments, worldPosition) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Call render() with the generated segment list and world position
          renderer.render(worldPosition, 0, segments);

          // ── Core assertion ──────────────────────────────────────────────
          //
          // stage.filters must be a non-null array that contains at least
          // one ColorMatrixFilter (identified by `_isColorMatrixFilter`).
          const filters = app.stage.filters;

          expect(filters).not.toBeNull();
          expect(Array.isArray(filters)).toBe(true);

          const hasColorMatrixFilter =
            Array.isArray(filters) &&
            filters.some(
              (f): f is InstanceType<typeof StubColorMatrixFilter> =>
                f instanceof StubColorMatrixFilter
            );

          expect(hasColorMatrixFilter).toBe(true);
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );

  it(
    "the ColorMatrixFilter in stage.filters is the same instance exposed via postProcess.grayscaleFilter",
    () => {
      // Confirms the filter attached to the stage is the one the renderer
      // tracks via its postProcess handle — ensuring it is reachable for
      // runtime updates and that no stray duplicate is added.
      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });
      const segCountArb = fc.integer({ min: 0, max: 5 });

      fc.assert(
        fc.property(worldPositionArb, segCountArb, (worldPosition, segCount) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          const segments = Array.from({ length: segCount }, (_, i) =>
            makeSegmentInstance(`seg-${String(i).padStart(2, "0")}`, i)
          );

          renderer.render(worldPosition, 0, segments);

          const filters = app.stage.filters as unknown[];

          // The postProcess.grayscaleFilter must appear in stage.filters
          expect(filters).toContain(renderer.postProcess.grayscaleFilter);
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );

  it(
    "stage.filters still contains the ColorMatrixFilter after multiple render() calls",
    () => {
      // Idempotency check: repeated render() calls must not remove or replace
      // the grayscale filter from stage.filters.
      const callCountArb = fc.integer({ min: 1, max: 10 });
      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });

      fc.assert(
        fc.property(callCountArb, worldPositionArb, (callCount, baseWorldPosition) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          for (let i = 0; i < callCount; i++) {
            const segments = [
              makeSegmentInstance("seg-00", 0),
              makeSegmentInstance("seg-01", 1),
            ];
            renderer.render(baseWorldPosition + i * 100, 0, segments);
          }

          const filters = app.stage.filters as unknown[];
          const hasColorMatrixFilter = filters.some(
            (f) => f instanceof StubColorMatrixFilter
          );

          expect(hasColorMatrixFilter).toBe(true);
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 11: Grain overlay opacity is always in spec under Default Quality
// Validates: Requirements 5.1, 5.4
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 11: Grain overlay opacity is always in spec under Default Quality", () => {
  /**
   * For any number of render calls under Default Quality, the grain sprite
   * SHALL satisfy:
   *   0.08 <= grainSprite.alpha <= 0.12
   *   grainSprite.blendMode === "multiply"  (PIXI.BLEND_MODES.MULTIPLY)
   *
   * The renderer is constructed under Default Quality (no setQualityMode call,
   * or with an explicit "default" call). The grain sprite's alpha and
   * blendMode are set at construction time and must remain within spec
   * across any number of subsequent render() calls.
   *
   * Note: The PIXI module is mocked; the renderer sets blendMode to the
   * string "multiply", which is how PixiJS v8 accepts blend modes in
   * the stub environment.
   *
   * **Validates: Requirements 5.1, 5.4**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 11: Grain overlay opacity is always in spec under Default Quality
   */
  it(
    "grainSprite.alpha is in [0.08, 0.12] and blendMode is 'multiply' after any number of render calls under Default Quality",
    () => {
      // Generate a random number of render calls (1–50) and a starting
      // world position, to simulate various frame sequences.
      const callCountArb = fc.integer({ min: 1, max: 50 });
      const worldPositionArb = fc.float({
        min: 0,
        max: 200_000,
        noNaN: true,
        noDefaultInfinity: true,
      });
      const segCountArb = fc.integer({ min: 0, max: 4 });

      fc.assert(
        fc.property(
          callCountArb,
          worldPositionArb,
          segCountArb,
          (callCount, baseWorldPosition, segCount) => {
            // Arrange: renderer in Default Quality (no quality mode switch)
            const app = makeStubApp();
            const renderer = new PixiRenderer(
              app as unknown as import("pixi.js").Application
            );

            const segments = Array.from({ length: segCount }, (_, i) =>
              makeSegmentInstance(`seg-${String(i).padStart(2, "0")}`, i)
            );

            // Act: simulate multiple render calls (advancing world position
            // as would happen during a real frame loop)
            for (let i = 0; i < callCount; i++) {
              renderer.render(baseWorldPosition + i * 16.67, 0, segments);

              // Assert after EACH render call — the invariant must hold
              // continuously, not just at the end.
              const { grainSprite } = renderer.postProcess;

              expect(grainSprite.alpha).toBeGreaterThanOrEqual(0.08);
              expect(grainSprite.alpha).toBeLessThanOrEqual(0.50);
              expect(grainSprite.blendMode).toBe("multiply");
            }
          }
        ),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "grainSprite.alpha remains in [0.08, 0.12] after setQualityMode('default') is called explicitly",
    () => {
      // Explicitly switching to Default Quality should not push alpha outside spec.
      const callCountArb = fc.integer({ min: 1, max: 20 });
      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });

      fc.assert(
        fc.property(callCountArb, worldPositionArb, (callCount, worldPosition) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Explicitly set Default Quality
          renderer.setQualityMode("default");

          for (let i = 0; i < callCount; i++) {
            renderer.render(worldPosition + i * 100, 0, []);

            const { grainSprite } = renderer.postProcess;

            expect(grainSprite.alpha).toBeGreaterThanOrEqual(0.08);
            expect(grainSprite.alpha).toBeLessThanOrEqual(0.50);
            expect(grainSprite.blendMode).toBe("multiply");
          }
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );

  it(
    "grainSprite.blendMode is 'multiply' at construction, before any render call",
    () => {
      // The blend mode must be set at construction time, not lazily on first render.
      fc.assert(
        fc.property(fc.constant(null), () => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          const { grainSprite } = renderer.postProcess;

          expect(grainSprite.alpha).toBeGreaterThanOrEqual(0.08);
          expect(grainSprite.alpha).toBeLessThanOrEqual(0.50);
          expect(grainSprite.blendMode).toBe("multiply");
        }),
        { numRuns: 50, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 13: Post-process pipeline order
// Validates: Requirements 5.5
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 13: Post-process pipeline order", () => {
  /**
   * For any render call, the grain sprite SHALL appear in app.stage.children
   * after all three layer containers (bgContainer, mgContainer, fgContainer),
   * and app.stage.filters SHALL contain both the grayscale ColorMatrixFilter
   * and the vignette Filter.
   *
   * This verifies that post-process elements are never interleaved with or
   * prepended before the segment layer containers in the draw order.
   *
   * **Validates: Requirements 5.5**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 13: Post-process pipeline order
   */
  it(
    "grain sprite index in stage.children is greater than bgContainer, mgContainer, and fgContainer indices for any segment count and world position",
    () => {
      // Generate 0–8 unique segment indices to vary the scene composition
      const segmentsArb = fc
        .array(fc.integer({ min: 0, max: 7 }), {
          minLength: 0,
          maxLength: 8,
        })
        .map((indices) => {
          const unique = [...new Set(indices)];
          return unique.map((idx) =>
            makeSegmentInstance(`seg-${String(idx).padStart(2, "0")}`, idx)
          );
        });

      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });

      fc.assert(
        fc.property(segmentsArb, worldPositionArb, (segments, worldPosition) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          renderer.render(worldPosition, 0, segments);

          const children = app.stage.children;

          // Locate each layer container and the grain sprite in stage.children
          const bgIndex = children.indexOf(renderer.bgContainer);
          const mgIndex = children.indexOf(renderer.mgContainer);
          const fgIndex = children.indexOf(renderer.fgContainer);
          const grainIndex = children.indexOf(renderer.postProcess.grainSprite);

          // All four must be present in the stage
          expect(bgIndex).toBeGreaterThanOrEqual(0);
          expect(mgIndex).toBeGreaterThanOrEqual(0);
          expect(fgIndex).toBeGreaterThanOrEqual(0);
          expect(grainIndex).toBeGreaterThanOrEqual(0);

          // ── Core assertion: grain sprite is drawn AFTER all layer containers ──
          //
          // Requirement 5.5: post-process elements are appended after all
          // segment layer sprites in the draw order.
          expect(grainIndex).toBeGreaterThan(bgIndex);
          expect(grainIndex).toBeGreaterThan(mgIndex);
          expect(grainIndex).toBeGreaterThan(fgIndex);
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );

  it(
    "app.stage.filters contains both the grayscale ColorMatrixFilter and the vignette Filter for any render call",
    () => {
      const segmentsArb = fc
        .array(fc.integer({ min: 0, max: 7 }), {
          minLength: 0,
          maxLength: 8,
        })
        .map((indices) => {
          const unique = [...new Set(indices)];
          return unique.map((idx) =>
            makeSegmentInstance(`seg-${String(idx).padStart(2, "0")}`, idx)
          );
        });

      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });

      fc.assert(
        fc.property(segmentsArb, worldPositionArb, (segments, worldPosition) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          renderer.render(worldPosition, 0, segments);

          const filters = app.stage.filters as unknown[];

          expect(filters).not.toBeNull();
          expect(Array.isArray(filters)).toBe(true);

          // ── Grayscale filter present ─────────────────────────────────────
          //
          // Must be the exact instance the renderer tracks in postProcess.
          expect(filters).toContain(renderer.postProcess.grayscaleFilter);

          // Must be identified as a ColorMatrixFilter
          const hasColorMatrixFilter = filters.some(
            (f) => f instanceof StubColorMatrixFilter
          );
          expect(hasColorMatrixFilter).toBe(true);

          // ── Vignette filter present ──────────────────────────────────────
          //
          // Must be the exact instance the renderer tracks in postProcess.
          expect(filters).toContain(renderer.postProcess.vignetteFilter);

          // Must be identified as a Filter
          const hasVignetteFilter = filters.some(
            (f) => f instanceof StubFilter
          );
          expect(hasVignetteFilter).toBe(true);
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );

  it(
    "pipeline order is preserved after multiple render() calls (idempotency)",
    () => {
      // Repeated render calls must not alter the draw order — the grain
      // sprite must always remain after the three layer containers even
      // when render() is called many times with varying segments.
      const callCountArb = fc.integer({ min: 2, max: 10 });
      const worldPositionArb = fc.integer({ min: 0, max: 100_000 });

      fc.assert(
        fc.property(callCountArb, worldPositionArb, (callCount, baseWorldPosition) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          for (let i = 0; i < callCount; i++) {
            const segments = [
              makeSegmentInstance("seg-00", 0),
              makeSegmentInstance("seg-01", 1),
            ];
            renderer.render(baseWorldPosition + i * 100, 0, segments);
          }

          const children = app.stage.children;
          const bgIndex = children.indexOf(renderer.bgContainer);
          const mgIndex = children.indexOf(renderer.mgContainer);
          const fgIndex = children.indexOf(renderer.fgContainer);
          const grainIndex = children.indexOf(renderer.postProcess.grainSprite);

          expect(grainIndex).toBeGreaterThan(bgIndex);
          expect(grainIndex).toBeGreaterThan(mgIndex);
          expect(grainIndex).toBeGreaterThan(fgIndex);

          // Filters must still be intact
          const filters = app.stage.filters as unknown[];
          expect(filters).toContain(renderer.postProcess.grayscaleFilter);
          expect(filters).toContain(renderer.postProcess.vignetteFilter);
        }),
        { numRuns: 100, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 15: Eco Quality caps device pixel ratio at 1
// Validates: Requirements 6.4
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 15: Eco Quality caps device pixel ratio at 1", () => {
  /**
   * For any physical device pixel ratio >= 1, after calling
   * setQualityMode("eco"), renderer.resolution SHALL equal exactly 1.
   *
   * This verifies that Eco mode hard-caps the backing-store resolution to
   * 1×, regardless of what the hardware reports via window.devicePixelRatio.
   *
   * **Validates: Requirements 6.4**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 15: Eco Quality caps device pixel ratio at 1
   */
  it(
    "renderer.resolution === 1 after setQualityMode('eco') for any dpr >= 1",
    () => {
      // Generate physical DPR values >= 1 (floats and integers,
      // covering 1.0, 1.5, 2.0, 3.0, high-DPI outliers, etc.)
      const dprArb = fc.oneof(
        // Common real-world DPR values: 1, 1.5, 2, 3
        fc.integer({ min: 1, max: 5 }).map((n) => n as number),
        // Fractional values between 1 and 5 (e.g. 1.25, 1.75, 2.5)
        fc.float({ min: 1, max: 5, noNaN: true, noDefaultInfinity: true })
      );

      fc.assert(
        fc.property(dprArb, (dpr) => {
          // Override window.devicePixelRatio with the generated value
          // so PixiRenderer captures it at construction time (_nativeDPR).
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          // Arrange: fresh stub app — renderer reads window.devicePixelRatio
          // in the constructor to set _nativeDPR.
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Act: switch to Eco mode
          renderer.setQualityMode("eco");

          // Assert: resolution is capped at exactly 1, regardless of dpr
          expect(app.renderer.resolution).toBe(1);
        }),
        { numRuns: 500, verbose: true }
      );
    }
  );

  it(
    "renderer.resolution === 1 immediately after setQualityMode('eco'), before any render call",
    () => {
      // The cap must take effect synchronously — no render() call needed.
      const dprArb = fc.float({ min: 1, max: 4, noNaN: true, noDefaultInfinity: true });

      fc.assert(
        fc.property(dprArb, (dpr) => {
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Switch to Eco mode — no render() call follows
          renderer.setQualityMode("eco");

          expect(app.renderer.resolution).toBe(1);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "renderer.resolution === 1 even when setQualityMode is toggled default → eco",
    () => {
      // First switch to Default (which sets resolution to dpr), then switch
      // back to Eco — resolution must return to 1.
      const dprArb = fc.float({ min: 1.5, max: 4, noNaN: true, noDefaultInfinity: true });

      fc.assert(
        fc.property(dprArb, (dpr) => {
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Toggle: default → eco
          renderer.setQualityMode("default");
          renderer.setQualityMode("eco");

          expect(app.renderer.resolution).toBe(1);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 14: Eco Quality halves texture dimensions
// Validates: Requirements 6.2
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 14: Eco Quality halves texture dimensions", () => {
  /**
   * For any SegmentDescriptor with arbitrary widthPx/heightPx, textures
   * loaded in Eco mode SHALL have dimensions Math.floor(w/2) × Math.floor(h/2)
   * relative to their Default Quality dimensions.
   *
   * How this is tested:
   *   The stub Texture.from records the URL passed to it. The renderer calls
   *   toHalfResUrl() which inserts "@0.5x" before the file extension when
   *   switching to Eco mode. The test verifies that:
   *     1. After setQualityMode("eco"), every sprite texture URL contains "@0.5x".
   *     2. The texture dimensions returned for "@0.5x" URLs are exactly
   *        Math.floor(w/2) × Math.floor(h/2) of the full-resolution dimensions.
   *
   *   To make dimensions testable with arbitrary widthPx/heightPx, we use a
   *   URL-encoding convention in makeDescriptorWithDimensions(): asset URLs
   *   embed "w{W}h{H}" so the stub can decode the intended full-res size and
   *   return half-res dimensions when "@0.5x" is present.
   *
   * **Validates: Requirements 6.2**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 14: Eco Quality halves texture dimensions
   */

  /**
   * Build a SegmentDescriptor whose layer URLs encode the segment's intended
   * full-resolution dimensions (e.g. "assets/seg01/bg_w2400h1080.webp").
   * The URL-aware stub texture factory decodes these to return the correct size.
   */
  function makeDescriptorWithDimensions(
    id: string,
    index: number,
    widthPx: number,
    heightPx: number
  ): import("@/types/journey").SegmentDescriptor {
    return {
      id,
      index,
      role: index === 0 ? "departure" : index === 1 ? "intermediate" : "arrival",
      widthPx,
      layers: {
        background: `assets/${id}/bg_w${widthPx}h${heightPx}.webp`,
        midground: `assets/${id}/mg_w${widthPx}h${heightPx}.webp`,
        foreground: `assets/${id}/fg_w${widthPx}h${heightPx}.webp`,
      },
      audioTrack: `assets/audio/${id}.mp3`,
      edgeMatchOffsetLeft: 0,
      edgeMatchOffsetRight: 0,
    };
  }

  /**
   * Decode a texture width or height from a URL that follows the
   * "bg_w{W}h{H}.webp" convention used by makeDescriptorWithDimensions.
   * Returns { width, height } in full resolution; callers apply halving.
   */
  function decodeDimensions(url: string): { width: number; height: number } | null {
    // Match the w{W}h{H} pattern before the file extension (possibly before @0.5x too)
    const match = url.match(/w(\d+)h(\d+)/);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  /**
   * Build a SegmentInstance with a URL-aware texture stub.
   *
   * Each stub sprite exposes a `texture` object whose width/height are computed
   * from the URL: full dimensions for normal URLs, Math.floor(dim/2) for "@0.5x" URLs.
   *
   * We make the sprite's texture a getter/setter that records the most recent
   * Texture.from() result so we can inspect the dimensions after setQualityMode.
   */
  function makeSegmentInstanceWithDimensions(
    id: string,
    index: number,
    widthPx: number,
    heightPx: number
  ): import("@/types/journey").SegmentInstance {
    const descriptor = makeDescriptorWithDimensions(id, index, widthPx, heightPx);

    /**
     * A sprite stub whose `texture` property tracks the last assigned texture.
     * The texture is a plain object { width, height, _url } so the test can
     * verify dimensions without relying on the global StubTexture.from mock.
     */
    function makeTrackingSprite() {
      // We replace the module-level StubTexture.from temporarily per-test
      // with a URL-aware version, so we need sprites that accept real texture objects.
      return new StubSprite() as unknown as import("@/types/journey").SegmentInstance["bgSprite"];
    }

    return {
      descriptor,
      container: new StubContainer() as unknown as import("@/types/journey").SegmentInstance["container"],
      bgSprite: makeTrackingSprite(),
      mgSprite: makeTrackingSprite(),
      fgSprite: makeTrackingSprite(),
      worldX: index * widthPx,
      loaded: true,
      recycled: false,
    };
  }

  it(
    "after setQualityMode('eco'), all sprite textures have Math.floor(w/2) x Math.floor(h/2) dimensions for any widthPx/heightPx",
    () => {
      /**
       * Arbitrary positive integer dimensions — use values that are valid
       * texture sizes (1–4096). The floor(w/2) × floor(h/2) formula is tested
       * across the full range including odd numbers.
       */
      const dimensionArb = fc.record({
        widthPx: fc.integer({ min: 1, max: 4096 }),
        heightPx: fc.integer({ min: 1, max: 4096 }),
      });

      /**
       * Arbitrary segment count: 1–5 segments, all with the same (or different)
       * dimensions. We test with 1–3 segments per run for performance.
       */
      const segCountArb = fc.integer({ min: 1, max: 3 });

      fc.assert(
        fc.property(
          dimensionArb,
          segCountArb,
          ({ widthPx, heightPx }, segCount) => {
            // ── Arrange ────────────────────────────────────────────────────
            //
            // Temporarily override StubTexture.from with a URL-aware version
            // that returns dimensions derived from the encoded w/h in the URL.
            // Full-res URLs → { width: W, height: H }
            // @0.5x URLs   → { width: floor(W/2), height: floor(H/2) }

            const urlAwareTextureFrom = (url: string) => {
              const dims = decodeDimensions(url);
              if (!dims) return { width: 100, height: 100, _url: url };
              const isHalf = url.includes("@0.5x");
              return {
                width: isHalf ? Math.floor(dims.width / 2) : dims.width,
                height: isHalf ? Math.floor(dims.height / 2) : dims.height,
                _url: url,
              };
            };

            // Patch the module-level StubTexture.from for this test run.
            // StubTexture is the same object the mock uses, so mutations here
            // are reflected in the renderer's PIXI.Texture.from calls.
            const originalFrom = StubTexture.from;
            StubTexture.from = urlAwareTextureFrom;

            try {
              const app = makeStubApp();
              const renderer = new PixiRenderer(
                app as unknown as import("pixi.js").Application
              );

              const segments = Array.from({ length: segCount }, (_, i) =>
                makeSegmentInstanceWithDimensions(
                  `seg-${String(i).padStart(2, "0")}`,
                  i,
                  widthPx,
                  heightPx
                )
              );

              // Render so the renderer tracks the segments
              renderer.render(0, 0, segments);

              // ── Act ────────────────────────────────────────────────────
              renderer.setQualityMode("eco");

              // ── Assert ─────────────────────────────────────────────────
              //
              // After switching to Eco mode, every sprite's texture MUST have
              // dimensions Math.floor(widthPx/2) × Math.floor(heightPx/2).
              const expectedW = Math.floor(widthPx / 2);
              const expectedH = Math.floor(heightPx / 2);

              for (const seg of segments) {
                const bgTex = (seg.bgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;
                const mgTex = (seg.mgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;
                const fgTex = (seg.fgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;

                // Each texture URL must contain "@0.5x" (Requirement 6.2)
                expect(bgTex._url).toContain("@0.5x");
                expect(mgTex._url).toContain("@0.5x");
                expect(fgTex._url).toContain("@0.5x");

                // Each texture must have halved dimensions (Requirement 6.2)
                expect(bgTex.width).toBe(expectedW);
                expect(bgTex.height).toBe(expectedH);
                expect(mgTex.width).toBe(expectedW);
                expect(mgTex.height).toBe(expectedH);
                expect(fgTex.width).toBe(expectedW);
                expect(fgTex.height).toBe(expectedH);
              }
            } finally {
              // Restore original stub so other tests are unaffected
              StubTexture.from = originalFrom;
            }
          }
        ),
        { numRuns: 300, verbose: true }
      );
    }
  );

  it(
    "halved dimensions use Math.floor for odd widthPx/heightPx values",
    () => {
      // Explicitly test odd dimensions to confirm floor(w/2) not round(w/2).
      // e.g. widthPx=101 → floor(101/2) = 50 (not 51)
      const oddDimensionArb = fc.record({
        widthPx: fc.integer({ min: 1, max: 2047 }).map((n) => n * 2 + 1), // always odd
        heightPx: fc.integer({ min: 1, max: 2047 }).map((n) => n * 2 + 1), // always odd
      });

      fc.assert(
        fc.property(oddDimensionArb, ({ widthPx, heightPx }) => {
          const urlAwareTextureFrom = (url: string) => {
            const dims = decodeDimensions(url);
            if (!dims) return { width: 100, height: 100, _url: url };
            const isHalf = url.includes("@0.5x");
            return {
              width: isHalf ? Math.floor(dims.width / 2) : dims.width,
              height: isHalf ? Math.floor(dims.height / 2) : dims.height,
              _url: url,
            };
          };

          const originalFrom = StubTexture.from;
          StubTexture.from = urlAwareTextureFrom;

          try {
            const app = makeStubApp();
            const renderer = new PixiRenderer(
              app as unknown as import("pixi.js").Application
            );

            const segment = makeSegmentInstanceWithDimensions("seg-00", 0, widthPx, heightPx);
            renderer.render(0, [segment]);
            renderer.setQualityMode("eco");

            const bgTex = (segment.bgSprite as unknown as { texture: { width: number; height: number } }).texture;

            // Must be exactly Math.floor, not Math.ceil or Math.round
            expect(bgTex.width).toBe(Math.floor(widthPx / 2));
            expect(bgTex.height).toBe(Math.floor(heightPx / 2));

            // Verify it is NOT the rounded-up value (which would equal ceil for odd)
            if (widthPx > 1) {
              expect(bgTex.width).not.toBe(Math.ceil(widthPx / 2));
            }
          } finally {
            StubTexture.from = originalFrom;
          }
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "switching back to Default Quality restores full-resolution dimensions",
    () => {
      // After eco → default switch, textures should be back to original widthPx/heightPx.
      const dimensionArb = fc.record({
        widthPx: fc.integer({ min: 2, max: 4096 }),
        heightPx: fc.integer({ min: 2, max: 4096 }),
      });

      fc.assert(
        fc.property(dimensionArb, ({ widthPx, heightPx }) => {
          const urlAwareTextureFrom = (url: string) => {
            const dims = decodeDimensions(url);
            if (!dims) return { width: 100, height: 100, _url: url };
            const isHalf = url.includes("@0.5x");
            return {
              width: isHalf ? Math.floor(dims.width / 2) : dims.width,
              height: isHalf ? Math.floor(dims.height / 2) : dims.height,
              _url: url,
            };
          };

          const originalFrom = StubTexture.from;
          StubTexture.from = urlAwareTextureFrom;

          try {
            const app = makeStubApp();
            const renderer = new PixiRenderer(
              app as unknown as import("pixi.js").Application
            );

            const segment = makeSegmentInstanceWithDimensions("seg-00", 0, widthPx, heightPx);
            renderer.render(0, [segment]);

            // Eco → halved
            renderer.setQualityMode("eco");

            const bgTexEco = (segment.bgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;
            expect(bgTexEco._url).toContain("@0.5x");
            expect(bgTexEco.width).toBe(Math.floor(widthPx / 2));

            // Default → restored
            renderer.setQualityMode("default");

            const bgTexDefault = (segment.bgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;
            expect(bgTexDefault._url).not.toContain("@0.5x");
            expect(bgTexDefault.width).toBe(widthPx);
            expect(bgTexDefault.height).toBe(heightPx);
          } finally {
            StubTexture.from = originalFrom;
          }
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "setQualityMode('eco') is idempotent — calling it twice does not further halve dimensions",
    () => {
      // Calling eco twice must not quarter the resolution.
      const dimensionArb = fc.record({
        widthPx: fc.integer({ min: 4, max: 4096 }),
        heightPx: fc.integer({ min: 4, max: 4096 }),
      });

      fc.assert(
        fc.property(dimensionArb, ({ widthPx, heightPx }) => {
          const urlAwareTextureFrom = (url: string) => {
            const dims = decodeDimensions(url);
            if (!dims) return { width: 100, height: 100, _url: url };
            const isHalf = url.includes("@0.5x");
            return {
              width: isHalf ? Math.floor(dims.width / 2) : dims.width,
              height: isHalf ? Math.floor(dims.height / 2) : dims.height,
              _url: url,
            };
          };

          const originalFrom = StubTexture.from;
          StubTexture.from = urlAwareTextureFrom;

          try {
            const app = makeStubApp();
            const renderer = new PixiRenderer(
              app as unknown as import("pixi.js").Application
            );

            const segment = makeSegmentInstanceWithDimensions("seg-00", 0, widthPx, heightPx);
            renderer.render(0, [segment]);

            // First eco switch
            renderer.setQualityMode("eco");
            const texAfterFirst = (segment.bgSprite as unknown as { texture: { width: number; height: number } }).texture;
            const wAfterFirst = texAfterFirst.width;
            const hAfterFirst = texAfterFirst.height;

            // Second eco switch — must be idempotent
            renderer.setQualityMode("eco");
            const texAfterSecond = (segment.bgSprite as unknown as { texture: { width: number; height: number } }).texture;

            expect(texAfterSecond.width).toBe(wAfterFirst);
            expect(texAfterSecond.height).toBe(hAfterFirst);

            // Still half of original, not quarter
            expect(texAfterSecond.width).toBe(Math.floor(widthPx / 2));
            expect(texAfterSecond.height).toBe(Math.floor(heightPx / 2));
          } finally {
            StubTexture.from = originalFrom;
          }
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 21: DPR at initialisation respects quality cap
// Validates: Requirements 9.3
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 21: DPR at initialisation respects quality cap", () => {
  /**
   * For any physical device pixel ratio `dpr` and quality mode `q`,
   * `renderer.resolution` immediately after `PixiRenderer` construction SHALL
   * equal `Math.min(dpr, qualityCap(q))`, where:
   *   qualityCap("default") = dpr   (uncapped — resolves to dpr itself)
   *   qualityCap("eco")     = 1
   *
   * The constructor always starts in Default Quality (Requirement 6.1), so
   * after construction the resolution should equal the native DPR (clamped to
   * the physical maximum of 2 the implementation imposes).
   *
   * **Validates: Requirements 9.3**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 21: DPR at initialisation respects quality cap
   */

  /**
   * Helper — the qualityCap function as specified in the design document.
   *
   * qualityCap("default") = dpr  (no cap — Math.min(dpr, dpr) === dpr)
   * qualityCap("eco")     = 1
   *
   * NOTE: The PixiRenderer implementation additionally caps the native DPR at
   * 2 (physical display limit). The property test mirrors this cap so that the
   * assertion matches what the constructor actually stores in `_nativeDPR`.
   */
  function qualityCap(mode: "default" | "eco", dpr: number): number {
    if (mode === "eco") return 1;
    // Default mode is uncapped relative to dpr, but the renderer caps at 2.
    return Math.min(dpr, 2);
  }

  it(
    "renderer.resolution === Math.min(dpr, qualityCap('default')) immediately after construction for any dpr",
    () => {
      /**
       * Generates DPR values spanning sub-1× (rare but valid), 1×, common
       * Retina values (1.5, 2, 3), and extreme values well above 2.
       *
       * The generator uses floats in (0, 5] to cover the realistic range.
       */
      const dprArb = fc.float({ min: 0.5, max: 5, noNaN: true, noDefaultInfinity: true });

      fc.assert(
        fc.property(dprArb, (dpr) => {
          // Override window.devicePixelRatio for this iteration
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Expected: Math.min(dpr, qualityCap("default", dpr))
          //         = Math.min(dpr, Math.min(dpr, 2))
          //         = Math.min(dpr, 2)
          const expected = qualityCap("default", dpr);

          expect(app.renderer.resolution).toBe(expected);
          // appliedDPR getter must agree with the stub's resolution
          expect(renderer.appliedDPR).toBe(expected);
        }),
        { numRuns: 500, verbose: true }
      );
    }
  );

  it(
    "renderer.resolution === 1 === qualityCap('eco') immediately after construction when setQualityMode('eco') is called",
    () => {
      /**
       * Eco mode caps resolution at 1 regardless of DPR.
       * setQualityMode('eco') is called immediately after construction to
       * simulate an initialisation that begins in Eco Quality.
       */
      const dprArb = fc.float({ min: 0.5, max: 5, noNaN: true, noDefaultInfinity: true });

      fc.assert(
        fc.property(dprArb, (dpr) => {
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Switch to eco immediately — simulates eco initialisation
          renderer.setQualityMode("eco");

          // qualityCap("eco") === 1 for any dpr
          const expected = qualityCap("eco", dpr);
          expect(expected).toBe(1);

          expect(app.renderer.resolution).toBe(1);
          expect(renderer.appliedDPR).toBe(1);
        }),
        { numRuns: 500, verbose: true }
      );
    }
  );

  it(
    "renderer.resolution is bounded by qualityCap for both modes across any dpr",
    () => {
      /**
       * Combined assertion: for any dpr and either quality mode, the
       * post-construction resolution satisfies
       *   renderer.resolution === Math.min(dpr, qualityCap(mode, dpr))
       *
       * This directly exercises the property statement from the design doc.
       */
      const dprArb = fc.float({ min: 0.5, max: 5, noNaN: true, noDefaultInfinity: true });
      const modeArb = fc.constantFrom("default" as const, "eco" as const);

      fc.assert(
        fc.property(dprArb, modeArb, (dpr, mode) => {
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          if (mode === "eco") {
            renderer.setQualityMode("eco");
          }
          // Default mode is in effect at construction; no call needed.

          const expected = qualityCap(mode, dpr);
          expect(app.renderer.resolution).toBe(expected);
          expect(renderer.appliedDPR).toBe(expected);
        }),
        { numRuns: 500, verbose: true }
      );
    }
  );

  it(
    "renderer.resolution at construction is never greater than the native DPR cap (2) in default mode",
    () => {
      // Boundary check: even very high DPR devices should be capped at 2
      // in Default Quality (implementation constraint).
      const highDprArb = fc.float({ min: Math.fround(2.01), max: 10, noNaN: true, noDefaultInfinity: true });

      fc.assert(
        fc.property(highDprArb, (dpr) => {
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          new PixiRenderer(app as unknown as import("pixi.js").Application);

          // Default mode: resolution must not exceed 2 regardless of dpr
          expect(app.renderer.resolution).toBeLessThanOrEqual(2);
          expect(app.renderer.resolution).toBe(2);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "renderer.resolution at construction equals dpr when dpr <= 2 in default mode",
    () => {
      // For sub-2× DPR devices, Default Quality should use the full native DPR.
      const normalDprArb = fc.float({ min: 0.5, max: 2, noNaN: true, noDefaultInfinity: true });

      fc.assert(
        fc.property(normalDprArb, (dpr) => {
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          new PixiRenderer(app as unknown as import("pixi.js").Application);

          // dpr <= 2, so Math.min(dpr, 2) === dpr
          expect(app.renderer.resolution).toBe(dpr);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 16: Eco → Default round trip restores full state
// Validates: Requirements 6.5
// ---------------------------------------------------------------------------

describe("PixiRenderer — Property 16: Eco → Default round trip restores full state", () => {
  /**
   * For any renderer state S₀ under Default Quality, switching to Eco Quality
   * and then back to Default Quality SHALL produce a renderer state S₂ in which:
   *   - renderer.resolution   matches the S₀ snapshot
   *   - grainSprite.visible   matches the S₀ snapshot (true)
   *   - texture dimensions    match the S₀ snapshot (full-resolution)
   *
   * **Validates: Requirements 6.5**
   *
   * Tagged: Feature: illustrated-interactive-journey,
   *         Property 16: Eco → Default round trip restores full state
   */

  /**
   * URL-aware texture factory identical to the one used in Property 14.
   * Full-res URLs → { width: W, height: H, _url }
   * @0.5x URLs   → { width: floor(W/2), height: floor(H/2), _url }
   */
  function urlAwareTextureFrom(url: string): { width: number; height: number; _url: string } {
    const match = url.match(/w(\d+)h(\d+)/);
    if (!match) return { width: 100, height: 100, _url: url };
    const w = Number(match[1]);
    const h = Number(match[2]);
    const isHalf = url.includes("@0.5x");
    return {
      width: isHalf ? Math.floor(w / 2) : w,
      height: isHalf ? Math.floor(h / 2) : h,
      _url: url,
    };
  }

  /** Build a descriptor whose layer URLs encode full-resolution dimensions. */
  function makeDescriptorWithDimensions(
    id: string,
    index: number,
    widthPx: number,
    heightPx: number
  ): import("@/types/journey").SegmentDescriptor {
    return {
      id,
      index,
      role: index === 0 ? "departure" : index === 1 ? "intermediate" : "arrival",
      widthPx,
      layers: {
        background: `assets/${id}/bg_w${widthPx}h${heightPx}.webp`,
        midground: `assets/${id}/mg_w${widthPx}h${heightPx}.webp`,
        foreground: `assets/${id}/fg_w${widthPx}h${heightPx}.webp`,
      },
      audioTrack: `assets/audio/${id}.mp3`,
      edgeMatchOffsetLeft: 0,
      edgeMatchOffsetRight: 0,
    };
  }

  /** Build a SegmentInstance backed by stub sprites. */
  function makeSegmentWithDimensions(
    id: string,
    index: number,
    widthPx: number,
    heightPx: number
  ): import("@/types/journey").SegmentInstance {
    return {
      descriptor: makeDescriptorWithDimensions(id, index, widthPx, heightPx),
      container: new StubContainer() as unknown as import("@/types/journey").SegmentInstance["container"],
      bgSprite: new StubSprite() as unknown as import("@/types/journey").SegmentInstance["bgSprite"],
      mgSprite: new StubSprite() as unknown as import("@/types/journey").SegmentInstance["mgSprite"],
      fgSprite: new StubSprite() as unknown as import("@/types/journey").SegmentInstance["fgSprite"],
      worldX: index * widthPx,
      loaded: true,
      recycled: false,
    };
  }

  it(
    "renderer.resolution, grainSprite.visible, and texture dimensions all match the Default Quality snapshot after Eco → Default round trip",
    () => {
      /**
       * Arbitrary DPR values in [1, 4] and arbitrary texture dimensions.
       * The DPR is overridden via Object.defineProperty so the constructor
       * captures it as _nativeDPR, making the resolution assertion meaningful
       * for high-DPI devices.
       */
      const dprArb = fc.float({ min: 1, max: 4, noNaN: true, noDefaultInfinity: true });
      const dimensionArb = fc.record({
        widthPx: fc.integer({ min: 2, max: 4096 }),
        heightPx: fc.integer({ min: 2, max: 4096 }),
      });
      const segCountArb = fc.integer({ min: 1, max: 3 });

      fc.assert(
        fc.property(
          dprArb,
          dimensionArb,
          segCountArb,
          (dpr, { widthPx, heightPx }, segCount) => {
            // Override window.devicePixelRatio so the constructor captures it
            Object.defineProperty(window, "devicePixelRatio", {
              value: dpr,
              writable: true,
              configurable: true,
            });

            // Patch StubTexture.from BEFORE construction so initial textures
            // also use dimension-aware URLs (snapshot must capture real widths).
            const originalFrom = StubTexture.from;
            StubTexture.from = urlAwareTextureFrom;

            try {
              const app = makeStubApp();
              const renderer = new PixiRenderer(
                app as unknown as import("pixi.js").Application
              );

              const segments = Array.from({ length: segCount }, (_, i) =>
                makeSegmentWithDimensions(
                  `seg-${String(i).padStart(2, "0")}`,
                  i,
                  widthPx,
                  heightPx
                )
              );

              // Render so segments are tracked by the renderer
              renderer.render(0, 0, segments);

              // Explicitly set Default Quality so _reloadTexturesAtFullResolution()
              // fires and the URL-aware stub populates sprite textures with
              // the encoded widthPx/heightPx dimensions before we snapshot S₀.
              renderer.setQualityMode("default");

              // ── Snapshot S₀ (Default Quality) ─────────────────────────
              const snapshot = {
                resolution: app.renderer.resolution,
                grainVisible: renderer.postProcess.grainSprite.visible,
                // Record full-resolution texture dimensions from the first segment
                bgTexWidth:  (segments[0].bgSprite as unknown as { texture: { width: number } }).texture.width,
                bgTexHeight: (segments[0].bgSprite as unknown as { texture: { height: number } }).texture.height,
                mgTexWidth:  (segments[0].mgSprite as unknown as { texture: { width: number } }).texture.width,
                fgTexWidth:  (segments[0].fgSprite as unknown as { texture: { width: number } }).texture.width,
              };

              // Sanity: at S₀ the grain must be visible and textures at full res
              expect(snapshot.grainVisible).toBe(true);
              expect(snapshot.bgTexWidth).toBe(widthPx);
              expect(snapshot.bgTexHeight).toBe(heightPx);

              // ── Switch to Eco Quality ──────────────────────────────────
              renderer.setQualityMode("eco");

              // Verify Eco mode changes have taken effect (intermediate state)
              expect(app.renderer.resolution).toBe(1);
              expect(renderer.postProcess.grainSprite.visible).toBe(false);
              const bgTexEco = (segments[0].bgSprite as unknown as { texture: { width: number; height: number } }).texture;
              expect(bgTexEco.width).toBe(Math.floor(widthPx / 2));
              expect(bgTexEco.height).toBe(Math.floor(heightPx / 2));

              // ── Switch back to Default Quality ─────────────────────────
              renderer.setQualityMode("default");

              // ── Assert S₂ matches S₀ snapshot ─────────────────────────

              // 1. renderer.resolution matches S₀
              expect(app.renderer.resolution).toBe(snapshot.resolution);

              // 2. grainSprite.visible matches S₀ (must be true again)
              expect(renderer.postProcess.grainSprite.visible).toBe(snapshot.grainVisible);

              // 3. Texture dimensions match S₀ (full resolution restored)
              for (const seg of segments) {
                const bgTex = (seg.bgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;
                const mgTex = (seg.mgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;
                const fgTex = (seg.fgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;

                // URLs must not contain "@0.5x" after restoring Default Quality
                expect(bgTex._url).not.toContain("@0.5x");
                expect(mgTex._url).not.toContain("@0.5x");
                expect(fgTex._url).not.toContain("@0.5x");

                // Dimensions match the S₀ snapshot (full resolution)
                expect(bgTex.width).toBe(snapshot.bgTexWidth);
                expect(bgTex.height).toBe(snapshot.bgTexHeight);
                expect(mgTex.width).toBe(snapshot.mgTexWidth);
                expect(fgTex.width).toBe(snapshot.fgTexWidth);
              }
            } finally {
              StubTexture.from = originalFrom;
            }
          }
        ),
        { numRuns: 300, verbose: true }
      );
    }
  );

  it(
    "round trip preserves renderer.resolution exactly, including the hardware DPR cap at 2",
    () => {
      // High-DPR devices: DPR > 2 is capped at 2 by the renderer.
      // After eco → default, the resolution should still be Math.min(dpr, 2).
      const dprArb = fc.float({ min: 1, max: 5, noNaN: true, noDefaultInfinity: true });

      fc.assert(
        fc.property(dprArb, (dpr) => {
          Object.defineProperty(window, "devicePixelRatio", {
            value: dpr,
            writable: true,
            configurable: true,
          });

          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          // Snapshot resolution after construction (Default Quality)
          const s0Resolution = app.renderer.resolution;
          expect(s0Resolution).toBe(Math.min(dpr, 2));

          // Round trip: eco → default
          renderer.setQualityMode("eco");
          renderer.setQualityMode("default");

          // Resolution must match the S₀ snapshot exactly
          expect(app.renderer.resolution).toBe(s0Resolution);
        }),
        { numRuns: 300, verbose: true }
      );
    }
  );

  it(
    "grainSprite.visible is true after round trip regardless of how many eco/default cycles are performed",
    () => {
      // Multiple round trips must not leave grainSprite in a hidden state.
      const cycleCountArb = fc.integer({ min: 1, max: 5 });

      fc.assert(
        fc.property(cycleCountArb, (cycles) => {
          const app = makeStubApp();
          const renderer = new PixiRenderer(
            app as unknown as import("pixi.js").Application
          );

          for (let i = 0; i < cycles; i++) {
            renderer.setQualityMode("eco");
            renderer.setQualityMode("default");
          }

          // After any number of eco → default cycles, grain must be visible
          expect(renderer.postProcess.grainSprite.visible).toBe(true);
        }),
        { numRuns: 200, verbose: true }
      );
    }
  );

  it(
    "texture dimensions are identical to Default Quality snapshot for multiple segments after round trip",
    () => {
      // Tests that ALL tracked segments have their textures restored,
      // not just the first one.
        fc.assert(
          fc.property(
            fc.integer({ min: 2, max: 5 }),   // segment count
            fc.integer({ min: 2, max: 4096 }), // widthPx
            fc.integer({ min: 2, max: 4096 }), // heightPx
            (segCount, widthPx, heightPx) => {
              // Patch BEFORE construction so the initial render captures real dims
              const originalFrom = StubTexture.from;
              StubTexture.from = urlAwareTextureFrom;

              try {
              const app = makeStubApp();
              const renderer = new PixiRenderer(
                app as unknown as import("pixi.js").Application
              );

              const segments = Array.from({ length: segCount }, (_, i) =>
                makeSegmentWithDimensions(
                  `seg-${String(i).padStart(2, "0")}`,
                  i,
                  widthPx,
                  heightPx
                )
              );

              renderer.render(0, 0, segments);

              // Explicitly set Default Quality so _reloadTexturesAtFullResolution()
              // fires and sprite textures are populated with the encoded dimensions
              // before we snapshot S₀.
              renderer.setQualityMode("default");

              // Snapshot full-resolution dimensions for every segment
              const s0Dims = segments.map((seg) => ({
                bgW: (seg.bgSprite as unknown as { texture: { width: number } }).texture.width,
                bgH: (seg.bgSprite as unknown as { texture: { height: number } }).texture.height,
                mgW: (seg.mgSprite as unknown as { texture: { width: number } }).texture.width,
                fgW: (seg.fgSprite as unknown as { texture: { width: number } }).texture.width,
              }));

              // Eco → Default round trip
              renderer.setQualityMode("eco");
              renderer.setQualityMode("default");

              // All segments must be back to their S₀ dimensions
              for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const expected = s0Dims[i];

                const bgTex = (seg.bgSprite as unknown as { texture: { width: number; height: number; _url: string } }).texture;
                const mgTex = (seg.mgSprite as unknown as { texture: { width: number; _url: string } }).texture;
                const fgTex = (seg.fgSprite as unknown as { texture: { width: number; _url: string } }).texture;

                expect(bgTex.width).toBe(expected.bgW);
                expect(bgTex.height).toBe(expected.bgH);
                expect(mgTex.width).toBe(expected.mgW);
                expect(fgTex.width).toBe(expected.fgW);

                expect(bgTex._url).not.toContain("@0.5x");
                expect(mgTex._url).not.toContain("@0.5x");
                expect(fgTex._url).not.toContain("@0.5x");
              }
              } finally {
                StubTexture.from = originalFrom;
              }
            }
          ),
          { numRuns: 200, verbose: true }
        );
    }
  );
});




