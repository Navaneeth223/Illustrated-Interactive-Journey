import { Application } from "pixi.js";

export interface AppOptions {
  /** Container element to append the canvas to. Defaults to document.body. */
  container?: HTMLElement;
  /** Called when the WebGL context is lost. e.preventDefault() is already invoked. */
  onContextLost?: () => void;
  /** Called when the WebGL context is restored and rendering can resume. */
  onContextRestored?: () => void;
  /** Called when the browser window is resized. */
  onResize?: () => void;
}

/**
 * App bootstrap — creates the PixiJS Application, mounts the canvas to the
 * DOM, and wires WebGL context-loss / context-restored events on the canvas.
 *
 * Context-loss callbacks are kept as plain functions so that App remains
 * decoupled from JourneyController at this stage. JourneyController will
 * provide the concrete recovery callbacks in task 12.
 */
export class App {
  /** The underlying PixiJS Application instance. */
  readonly app: Application;

  private readonly _container: HTMLElement;
  private readonly _onContextLost: (() => void) | undefined;
  private readonly _onContextRestored: (() => void) | undefined;
  private readonly _onResizeCallback: (() => void) | undefined;
  private readonly _onResize: () => void;

  constructor(options: AppOptions = {}) {
    this._container = options.container ?? document.body;
    this._onContextLost = options.onContextLost;
    this._onContextRestored = options.onContextRestored;
    this._onResizeCallback = options.onResize;
    this._onResize = () => {
      this._onResizeCallback?.();
    };
    this.app = new Application();
  }

  /**
   * Initialise the PixiJS renderer (async in PixiJS 8), append the canvas to
   * the container, and attach WebGL context-loss event listeners.
   */
  async init(): Promise<void> {
    await this.app.init({
      background: "#1a1814",
      resizeTo: window,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio ?? 1, 2),
    });

    // Hide the canvas until the journey transitions out of the gate phase.
    // JourneyController calls showCanvas() after the audio gate is dismissed.
    this.app.canvas.style.opacity = "0";
    this.app.canvas.style.transition = "opacity 0.4s ease";

    this._container.appendChild(this.app.canvas);
    this._wireContextEvents();
    window.addEventListener("resize", this._onResize);
  }

  /**
   * Fade the canvas in. Called by JourneyController after the audio gate
   * is dismissed so the canvas only becomes visible once the journey starts.
   */
  showCanvas(): void {
    this.app.canvas.style.opacity = "1";
  }

  /**
   * Attach `webglcontextlost` and `webglcontextrestored` listeners to the
   * canvas element. These will be forwarded to JourneyController once it is
   * instantiated in task 12.
   */
  private _wireContextEvents(): void {
    const canvas = this.app.canvas;

    canvas.addEventListener("webglcontextlost", (event: Event) => {
      // Calling preventDefault() is required to allow the browser to attempt
      // context restoration — without it the context is permanently lost.
      event.preventDefault();
      this._onContextLost?.();
    });

    canvas.addEventListener("webglcontextrestored", () => {
      this._onContextRestored?.();
    });
  }
}
