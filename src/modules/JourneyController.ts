import type { Application } from "pixi.js";
import type { JourneyState } from "@/types/journey";
import type { VelocityModel } from "@/modules/VelocityModel";
import type { MyrioramaSequencer } from "@/modules/MyrioramaSequencer";
import type { PixiRenderer } from "@/modules/PixiRenderer";
import type { AudioController } from "@/modules/AudioController";
import type { AudioGate } from "@/modules/AudioGate";
import type { InputController } from "@/modules/InputController";
import type { ArrivalScreen } from "@/modules/ArrivalScreen";

/**
 * JourneyController — owns the journey state machine and coordinates all
 * subsystems through the rAF loop.
 *
 * State machine:
 *   gate ──(audioGate resolved)──► travelling ──(isAtArrival)──► arrived
 *
 * Requirements: 1.2, 1.3, 1.4, 4.1, 4.2, 9.5
 */
export class JourneyController {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  private _phase: JourneyState["phase"] = "gate";

  private _lastTimestamp: number = 0;

  /** Handle for the pending requestAnimationFrame call; null when stopped. */
  private _rafHandle: number | null = null;

  /** Saved world position across a WebGL context-loss event. */
  private _savedPosition: number = 0;

  /** True while the WebGL context is lost and cannot be rendered. */
  private _contextLost: boolean = false;

  // Bound listener references retained for removal.
  private readonly _onHoldStart: () => void;
  private readonly _onHoldEnd: () => void;
  private readonly _onHoldStartBack: () => void;
  private readonly _onHoldEndBack: () => void;
  private readonly _onContextLost: (e: Event) => void;
  private readonly _onContextRestored: () => void;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(
    private readonly _audioGate: AudioGate,
    private readonly _velocityModel: VelocityModel,
    private readonly _sequencer: MyrioramaSequencer,
    private readonly _pixiRenderer: PixiRenderer,
    private readonly _audioController: AudioController,
    private readonly _inputController: InputController,
    private readonly _arrivalScreen: ArrivalScreen,
    private readonly _app: Application,
    private readonly _onCanvasReveal?: () => void,
  ) {
    // Pre-bind listener callbacks so they can be removed later.
    this._onHoldStart = () => {
      if (this._phase === "travelling") {
        this._velocityModel.startHold();
      }
    };

    this._onHoldEnd = () => {
      if (this._phase === "travelling") {
        this._velocityModel.releaseHold();
      }
    };

    this._onHoldStartBack = () => {
      if (this._phase === "travelling") {
        this._velocityModel.startHoldBack();
      }
    };

    this._onHoldEndBack = () => {
      if (this._phase === "travelling") {
        this._velocityModel.releaseHold();
      }
    };

    // WebGL context-loss listeners (Requirement 9.5).
    this._onContextLost = (e: Event) => {
      e.preventDefault();
      this._savedPosition = this.worldPosition;
      this._contextLost = true;
    };

    this._onContextRestored = () => {
      // PixiJS 8 handles context restoration automatically; we just need to
      // force-reload all textures and seek back to the saved position.
      this._sequencer.forceReloadAll();
      this.seekTo(this._savedPosition);
      this._contextLost = false;
    };

    // Wire context-loss events to the canvas.
    this._app.canvas.addEventListener("webglcontextlost", this._onContextLost);
    this._app.canvas.addEventListener("webglcontextrestored", this._onContextRestored);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start the journey.
   *
   * 1. Shows the audio gate and waits for the user's choice.
   * 2. Transitions to `"travelling"`, configures sound, subscribes inputs,
   *    and kicks off the rAF loop.
   *
   * Requirements: 1.2
   */
  async start(): Promise<void> {
    const choice = await this._audioGate.show();

    // Transition: gate → travelling
    this._phase = "travelling";
    this._audioController.setSoundEnabled(choice === "sound-on");

    // Reveal the canvas now that the gate overlay is gone.
    this._onCanvasReveal?.();

    // Subscribe input events.
    this._inputController.on("holdStart", this._onHoldStart);
    this._inputController.on("holdEnd", this._onHoldEnd);
    this._inputController.on("holdStartBack", this._onHoldStartBack);
    this._inputController.on("holdEndBack", this._onHoldEndBack);

    // Start audio on segment 0.
    this._audioController.transitionToSegment(0);

    // Kick off the rAF loop.
    this._lastTimestamp = performance.now();
    this._rafHandle = requestAnimationFrame(this._tick.bind(this));
  }

  /**
   * Delegate quality mode change to the renderer and persist the setting.
   *
   * @param mode - `"default"` for full quality, `"eco"` for reduced DPR / no grain.
   */
  setQualityMode(mode: "default" | "eco"): void {
    this._pixiRenderer.setQualityMode(mode);
  }

  /**
   * Handle a `webglcontextlost` event (called by App.ts).
   *
   * Saves the current world position and sets the internal context-lost flag
   * so the rAF loop skips rendering until the context is restored.
   *
   * Requirements: 9.5
   */
  handleContextLost(): void {
    this._savedPosition = this.worldPosition;
    this._contextLost = true;
  }

  /**
   * Handle a `webglcontextrestored` event (called by App.ts).
   *
   * Clears the context-lost flag, forces all segments to reload their textures,
   * and seeks back to the saved position so the scene is consistent.
   *
   * Requirements: 9.5
   */
  handleContextRestored(): void {
    this._contextLost = false;
    // PixiJS 8 handles context restoration automatically; force-reload textures
    // and seek back to the saved position.
    this._sequencer.forceReloadAll();
    this.seekTo(this._savedPosition);
  }

  /**
   * Seek to an arbitrary world position without replaying from the start.
   *
   * Used after WebGL context restoration to resume at the saved position.
   *
   * Requirements: 9.5
   */
  seekTo(pos: number): void {
    // Set position on VelocityModel directly (bypasses GSAP).
    (this._velocityModel as unknown as { _worldPosition: number })._worldPosition = pos;

    // Determine which segment the position falls in.
    const segments = this._sequencer.activeSegments;
    let currentSegmentIndex = 0;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].worldX <= pos) {
        currentSegmentIndex = i;
      }
    }

    // Re-sync audio to the correct segment.
    this._audioController.transitionToSegment(currentSegmentIndex);

    // Re-render at the new position.
    this._pixiRenderer.render(pos, 0, segments);
  }

  // -------------------------------------------------------------------------
  // Public getters
  // -------------------------------------------------------------------------

  /** Current world position in pixels (delegated to VelocityModel). */
  get worldPosition(): number {
    return this._velocityModel.worldPosition;
  }

  /** Current journey phase. */
  get phase(): JourneyState["phase"] {
    return this._phase;
  }

  // -------------------------------------------------------------------------
  // Private rAF loop
  // -------------------------------------------------------------------------

  /**
   * Called each animation frame while the journey is in the `"travelling"` phase.
   *
   * Tick order:
   *   1. VelocityModel.tick(dt)        — integrate position
   *   2. MyrioramaSequencer.update()   — load/recycle segments
   *   3. PixiRenderer.render()         — composite layers
   *   4. AudioController.setMotionState() — update audio volume
   *   5. Check arrival                 — transition to "arrived" if reached
   */
  private _tick(timestamp: number): void {
    // Skip rendering while the context is lost.
    if (!this._contextLost) {
      // Cap dt at 0.1 s to prevent a huge position jump after tab visibility loss.
      const rawDt = (timestamp - this._lastTimestamp) / 1000;
      const dt = Math.min(Math.max(0, rawDt), 0.1);
      this._lastTimestamp = timestamp;

      // 1. Integrate velocity → position.
      this._velocityModel.tick(dt);

      const pos = this._velocityModel.worldPosition;

      // 2. Update sequencer (load / recycle segments).
      this._sequencer.update(pos);

      // 2b. Update ground line for current segment.
      const activeSegs = this._sequencer.activeSegments;
      let currentSeg = activeSegs[0];
      for (const seg of activeSegs) {
        if (seg.worldX <= pos) currentSeg = seg;
      }
      if (currentSeg) {
        this._pixiRenderer.setGroundLine(currentSeg.descriptor.groundLineRatio);
      }

      // 3. Render the current frame.
      this._pixiRenderer.render(pos, this._velocityModel.velocity, this._sequencer.activeSegments);

      // 4. Notify audio of motion state.
      this._audioController.setMotionState(this._velocityModel.velocity > 0);

      // 5. Check arrival condition.
      if (this._sequencer.isAtArrival) {
        this._transitionToArrived();
        return; // Do not re-queue another frame.
      }
    }

    // Re-queue next frame while still travelling.
    if (this._phase === "travelling") {
      this._rafHandle = requestAnimationFrame(this._tick.bind(this));
    }
  }

  /**
   * Transition from `"travelling"` to `"arrived"`.
   *
   * Side effects:
   *  - Releases any active hold (velocity → 0).
   *  - Shows the arrival screen.
   *  - Unsubscribes input so further hold events are ignored.
   *
   * Requirements: 1.3
   */
  private _transitionToArrived(): void {
    this._phase = "arrived";

    // Cancel any pending rAF frame.
    if (this._rafHandle !== null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }

    // Stop movement.
    this._velocityModel.releaseHold();

    // Show the arrival overlay with a restart callback.
    this._arrivalScreen.show(() => {
      void this._restart();
    });

    // Unsubscribe input events.
    this._inputController.off("holdStart", this._onHoldStart);
    this._inputController.off("holdEnd", this._onHoldEnd);
    this._inputController.off("holdStartBack", this._onHoldStartBack);
    this._inputController.off("holdEndBack", this._onHoldEndBack);
  }

  /**
   * Reset the journey to position 0 and resume travelling.
   * Called when the user clicks "Ride again" on the arrival screen.
   */
  private _restart(): void {
    // Reset position and velocity to zero.
    (this._velocityModel as unknown as { _worldPosition: number })._worldPosition = 0;
    this._velocityModel._state.velocity = 0;

    // Re-render at position 0.
    this._pixiRenderer.render(0, 0, this._sequencer.activeSegments);

    // Restart audio from segment 0.
    this._audioController.transitionToSegment(0);

    // Transition back to travelling and re-subscribe inputs.
    this._phase = "travelling";
    this._inputController.on("holdStart", this._onHoldStart);
    this._inputController.on("holdEnd", this._onHoldEnd);
    this._inputController.on("holdStartBack", this._onHoldStartBack);
    this._inputController.on("holdEndBack", this._onHoldEndBack);

    this._lastTimestamp = performance.now();
    this._rafHandle = requestAnimationFrame(this._tick.bind(this));
  }
}
