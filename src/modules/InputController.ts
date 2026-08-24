/**
 * InputController — normalises mouse, touch, and keyboard inputs into two
 * abstract events: `holdStart` and `holdEnd`.
 *
 * Implements a minimal typed EventEmitter in browser-compatible code (no
 * Node.js dependencies). Keyboard events are attached to `window`; mouse and
 * touch events are attached to the supplied canvas element.
 *
 * Requirements: 4.5
 */

/** The set of events emitted by InputController. */
export interface InputEventMap {
  holdStart: void;
  holdEnd: void;
  holdStartBack: void;
  holdEndBack: void;
}

type InputEventName = keyof InputEventMap;

/** Listener signature — payload is void for both events. */
type InputListener = () => void;

export class InputController {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _listeners: Map<InputEventName, Set<InputListener>> = new Map();

  // Keep named references so they can be removed in destroy().
  private readonly _onMouseDown: (e: MouseEvent) => void;
  private readonly _onMouseUp: () => void;
  private readonly _onTouchStart: (e: TouchEvent) => void;
  private readonly _onTouchEnd: (e: TouchEvent) => void;
  private readonly _onKeyDown: (e: KeyboardEvent) => void;
  private readonly _onKeyUp: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;

    // --- Mouse: left button = forward, right button = backward ---
    this._onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        this.emit("holdStartBack");
      } else {
        this.emit("holdStart");
      }
    };
    this._onMouseUp = () => {
      this.emit("holdEnd");
      this.emit("holdEndBack");
    };

    // --- Touch: single touch = forward, two fingers = backward ---
    this._onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length >= 2) {
        this.emit("holdStartBack");
      } else {
        this.emit("holdStart");
      }
    };
    this._onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 0) {
        this.emit("holdEnd");
        this.emit("holdEndBack");
      }
    };

    // --- Keyboard: ArrowRight/Space = forward, ArrowLeft = backward ---
    this._onKeyDown = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.code === "ArrowRight") && !e.repeat) {
        this.emit("holdStart");
      }
      if (e.code === "ArrowLeft" && !e.repeat) {
        this.emit("holdStartBack");
      }
    };
    this._onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowRight") {
        this.emit("holdEnd");
      }
      if (e.code === "ArrowLeft") {
        this.emit("holdEndBack");
      }
    };

    this._attachListeners();
  }

  // ---------------------------------------------------------------------------
  // Public EventEmitter API
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to a `holdStart` or `holdEnd` event.
   * Adding the same listener twice has no effect.
   */
  on(event: InputEventName, listener: InputListener): void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(listener);
  }

  /**
   * Unsubscribe a previously registered listener.
   */
  off(event: InputEventName, listener: InputListener): void {
    this._listeners.get(event)?.delete(listener);
  }

  /**
   * Emit an event, invoking all registered listeners synchronously.
   * Internal — not part of the public contract but typed for clarity.
   */
  emit(event: InputEventName): void {
    this._listeners.get(event)?.forEach((fn) => fn());
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Remove all DOM event listeners wired in the constructor.
   * Call this when the InputController is no longer needed.
   */
  destroy(): void {
    this._canvas.removeEventListener("mousedown", this._onMouseDown);
    this._canvas.removeEventListener("mouseup", this._onMouseUp);
    this._canvas.removeEventListener("touchstart", this._onTouchStart);
    this._canvas.removeEventListener("touchend", this._onTouchEnd);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    this._listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _attachListeners(): void {
    this._canvas.addEventListener("mousedown", this._onMouseDown);
    this._canvas.addEventListener("mouseup", this._onMouseUp);

    // Suppress the browser context menu so right-click works as backward input.
    this._canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // `passive: false` is required to allow e.preventDefault() on touch events.
    this._canvas.addEventListener("touchstart", this._onTouchStart, { passive: false });
    this._canvas.addEventListener("touchend", this._onTouchEnd, { passive: false });

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }
}
