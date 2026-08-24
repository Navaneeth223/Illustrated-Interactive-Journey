import type { SegmentDescriptor, SegmentInstance } from "@/types/journey";

// ---------------------------------------------------------------------------
// Factory types
// ---------------------------------------------------------------------------

/**
 * A factory that creates a blank SegmentInstance shell for a given descriptor.
 * Injected at construction time so that the sequencer core logic can be tested
 * without a live PIXI context — callers supply lightweight stubs in tests and
 * real PIXI containers in production.
 *
 * Requirements: 2.1, 2.4
 */
export type SegmentInstanceFactory = (
  descriptor: SegmentDescriptor
) => SegmentInstance;

/**
 * Async callback invoked by the sequencer when a segment needs its assets
 * loaded.  Implementations should populate the sprites on the instance and
 * resolve when the segment is ready to render.  On failure the callback MUST
 * reject; the sequencer will retry once and then skip the segment.
 *
 * Requirements: 2.3
 */
export type LoadSegmentCallback = (
  instance: SegmentInstance
) => Promise<void>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Construction parameters for MyrioramaSequencer.
 */
export interface MyrioramaSequencerConfig {
  /** Ordered list of static segment descriptors (departure → arrival). */
  descriptors: SegmentDescriptor[];
  /** Width of the visible viewport in pixels (at 1× DPR). */
  viewportWidth: number;
  /** Factory that produces blank SegmentInstance shells. */
  instanceFactory: SegmentInstanceFactory;
  /** Async callback that loads assets into a SegmentInstance. */
  loadSegment: LoadSegmentCallback;
}

// ---------------------------------------------------------------------------
// MyrioramaSequencer
// ---------------------------------------------------------------------------

/**
 * MyrioramaSequencer — loads, positions, and recycles Segment instances as
 * the rider traverses the journey.
 *
 * **Edge-match invariant** (Requirement 2.1, 2.4):
 *   For all i in [0, segments.length - 2]:
 *     segments[i + 1].worldX === segments[i].worldX + segments[i].descriptor.widthPx
 *
 * The constructor assigns `worldX` values immediately, so the invariant holds
 * from the moment of construction and for the entire lifetime of the instance.
 *
 * `update(worldPosition)` is the per-frame hook called by JourneyController.
 * Lookahead loading (task 5.2) and off-screen recycling (task 5.3) will be
 * added in subsequent tasks; the stub here maintains the basic structure.
 *
 * Requirements: 2.1, 2.3, 2.4
 */
export class MyrioramaSequencer {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** All segment instances, ordered departure → arrival. */
  private readonly _segments: SegmentInstance[];

  /** Width of the visible viewport in px. */
  private _viewportWidth: number;

  /** Async loader for segment assets. */
  private readonly _loadSegment: LoadSegmentCallback;

  /** Tracks which segment indices are currently loading or have been loaded. */
  private readonly _loadInitiated: Set<number> = new Set();

  /** Current world position as of the last `update()` call. */
  private _worldPosition: number = 0;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Constructs the sequencer and immediately assigns `worldX` to every
   * segment instance so that the edge-match invariant holds from t = 0.
   *
   * @param config - Construction parameters (descriptors, viewportWidth,
   *                 instanceFactory, loadSegment).
   *
   * Requirements: 2.1, 2.4
   */
  constructor(config: MyrioramaSequencerConfig) {
    const { descriptors, viewportWidth, instanceFactory, loadSegment } = config;

    this._viewportWidth = viewportWidth;
    this._loadSegment = loadSegment;

    // Build segment instances and assign worldX values so that:
    //   segments[0].worldX = 0
    //   segments[i+1].worldX = segments[i].worldX + segments[i].descriptor.widthPx
    //
    // This single pass guarantees the edge-match invariant for all i.
    this._segments = [];
    let cursor = 0;
    for (const descriptor of descriptors) {
      const instance = instanceFactory(descriptor);
      instance.worldX = cursor;
      this._segments.push(instance);
      cursor += descriptor.widthPx;
    }
  }

  // -------------------------------------------------------------------------
  // Public getters
  // -------------------------------------------------------------------------

  /**
   * Returns all segment instances that are either loaded or currently being
   * loaded (i.e. not yet recycled).
   *
   * The PixiRenderer uses this list to composite parallax layers each frame.
   *
   * Requirements: 2.1
   */
  get activeSegments(): SegmentInstance[] {
    return this._segments.filter((s) => !s.recycled);
  }

  /**
   * The total world width spanned by all segments combined.
   *
   * Equals the sum of every `descriptor.widthPx`, which is also the worldX
   * of the hypothetical segment immediately past the arrival segment.
   *
   * Requirements: 2.1
   */
  get totalWorldWidth(): number {
    if (this._segments.length === 0) return 0;
    const last = this._segments[this._segments.length - 1];
    return last.worldX + last.descriptor.widthPx;
  }

  /**
   * True when the current world position has reached (or exceeded) the
   * terminal edge of the final segment, signalling that the rider has arrived.
   *
   * Requirements: 1.3 (via JourneyController) / 2.1
   */
  get isAtArrival(): boolean {
    return this._worldPosition >= this.totalWorldWidth;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /**
   * Called once per rAF tick by JourneyController with the latest world
   * position.
   *
   * Execution order:
   *   1. Recycle off-screen segments (memory first).
   *   2. Trigger lookahead loads for upcoming segments.
   *
   * Requirements: 2.1, 2.2, 2.3
   */
  update(worldPosition: number): void {
    this._worldPosition = worldPosition;

    // ── Step 1: Recycle segments that have fully scrolled off the left edge ──
    //
    // Recycle condition (Requirement 2.2):
    //   segment.worldX + segment.descriptor.widthPx < worldPosition - viewportWidth
    //
    // Only loaded segments have a live PIXI container to destroy.
    // Unloaded (never-loaded) segments are skipped because their containers
    // were never created, so there is nothing to destroy.
    for (const segment of this._segments) {
      if (segment.recycled) continue;
      if (!segment.loaded) continue; // no container to destroy

      const rightEdge = segment.worldX + segment.descriptor.widthPx;
      const recycleThreshold = worldPosition - this._viewportWidth;

      if (rightEdge < recycleThreshold) {
        // Destroy the PIXI container and all of its children to release GPU
        // textures and memory.  Guard against a missing container just in
        // case the object shape is inconsistent at runtime.
        if (segment.container) {
          segment.container.destroy({ children: true });
        }
        segment.recycled = true;
      }
    }

    // ── Step 2: Trigger lookahead loads for upcoming segments ──
    this._triggerLookaheadLoads(worldPosition);
  }

  // -------------------------------------------------------------------------
  // Force-reload (WebGL context recovery)
  // -------------------------------------------------------------------------

  /**
   * Clears all load-initiated markers and re-queues loads for every non-
   * recycled segment.  Called by JourneyController after a WebGL context
   * restore so all textures are re-uploaded.
   *
   * Requirements: 9.5 (via JourneyController)
   */
  forceReloadAll(): void {
    this._loadInitiated.clear();
    this._triggerLookaheadLoads(this._worldPosition);
  }

  /**
   * Update the viewport width — called on window resize.
   */
  updateViewportWidth(width: number): void {
    this._viewportWidth = width;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Triggers async loads for segments that satisfy the lookahead condition:
   *
   *   worldPosition + viewportWidth + segment.descriptor.widthPx >= segment.worldX
   *
   * This means: when the rider is within one segment-width of a segment's
   * left edge, begin loading it so its assets are ready before it enters
   * the viewport.
   *
   * Each segment is loaded at most once, guarded by `_loadInitiated`.
   * The set is checked (and the index added) before the async call to prevent
   * duplicate loads even while the first load is still in flight.
   *
   * All qualifying segments have their loads fired concurrently — the loop
   * does not `await` individual loads so that a slow-loading earlier segment
   * cannot block later segments from being triggered in the same update() call.
   *
   * Recycled segments are skipped — they have already scrolled off-screen and
   * their containers have been destroyed.
   *
   * On load failure the loader retries once; on the second failure it logs a
   * warning and skips the segment (via `_loadWithRetry`).
   *
   * Requirements: 2.3
   */
  private _triggerLookaheadLoads(worldPosition: number): void {
    for (let i = 0; i < this._segments.length; i++) {
      const segment = this._segments[i];

      // Skip segments that have already scrolled off-screen and been destroyed.
      if (segment.recycled) continue;

      // Guard against duplicate loads: the index is added to _loadInitiated
      // before the async call, so concurrent update() calls cannot race.
      if (this._loadInitiated.has(i)) continue;

      // Lookahead condition (Requirement 2.3 / Property 5):
      // Trigger when the rider is within one segment-width of the segment's
      // left edge — i.e. the segment will enter the viewport within the next
      // viewport-width of travel.
      const lookaheadReached =
        worldPosition + this._viewportWidth + segment.descriptor.widthPx >=
        segment.worldX;

      if (!lookaheadReached) continue;

      // Mark as initiated BEFORE the async load to prevent duplicate triggers.
      // All qualifying segments are fired concurrently — do not await here so
      // that a slow-loading earlier segment cannot block later segments from
      // being triggered within the same update() call.
      this._loadInitiated.add(i);
      void this._loadWithRetry(segment);
    }
  }

  /**
   * Loads a segment's assets, retrying once on failure.  On the second
   * failure a warning is logged and the segment is skipped.
   *
   * Requirements: 2.3 (error handling sub-requirement)
   */
  private async _loadWithRetry(segment: SegmentInstance): Promise<void> {
    try {
      await this._loadSegment(segment);
      segment.loaded = true;
    } catch (_firstError) {
      try {
        await this._loadSegment(segment);
        segment.loaded = true;
      } catch (secondError) {
        console.warn(
          `[MyrioramaSequencer] Failed to load segment "${segment.descriptor.id}" after retry. Skipping.`,
          secondError
        );
      }
    }
  }
}
