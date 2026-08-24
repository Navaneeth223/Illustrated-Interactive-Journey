/**
 * QualityHUD — accessible quality-mode toggle button.
 *
 * Renders a `<button>` that reflects the current quality mode via the
 * `aria-pressed` attribute:
 *   - "default" quality → aria-pressed="false"  (Eco mode is NOT active)
 *   - "eco" quality     → aria-pressed="true"   (Eco mode IS active)
 *
 * On click (or keyboard activation via Enter/Space, which native `<button>`
 * handles automatically), the component:
 *   1. Determines the next mode (toggle).
 *   2. Calls `pixiRenderer.setQualityMode(nextMode)` (Requirement 6.7).
 *   3. Updates the `JourneyState.qualityMode` field.
 *   4. Updates `aria-pressed` to reflect the new state.
 *
 * The button is focusable and keyboard-reachable by default because it is a
 * native `<button>` element (Requirement 6.6).
 *
 * Requirements: 6.6, 6.7
 */

import type { JourneyState } from "@/types/journey";
import type { PixiRenderer } from "@/modules/PixiRenderer";

export class QualityHUD {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  private readonly _button: HTMLButtonElement;
  private readonly _renderer: PixiRenderer;
  private readonly _state: JourneyState;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates a `QualityHUD` and appends the toggle button to `container`.
   *
   * @param container     - The DOM element to which the button is appended.
   * @param pixiRenderer  - The renderer whose `setQualityMode()` is called on toggle.
   * @param journeyState  - The shared runtime state object whose `qualityMode`
   *                        field is updated on toggle.
   */
  constructor(
    container: HTMLElement,
    pixiRenderer: PixiRenderer,
    journeyState: JourneyState
  ) {
    this._renderer = pixiRenderer;
    this._state = journeyState;

    // ── Create the toggle button ────────────────────────────────────────────
    this._button = document.createElement("button");
    this._button.type = "button";
    this._button.id = "ijj-quality-toggle";

    // aria-pressed reflects whether Eco mode is ON.
    // "default" → eco OFF → aria-pressed="false"
    // "eco"     → eco ON  → aria-pressed="true"
    this._button.setAttribute(
      "aria-pressed",
      String(journeyState.qualityMode === "eco")
    );
    this._button.setAttribute("aria-label", "Toggle Eco Quality mode");

    this._updateLabel();

    // ── Click handler ───────────────────────────────────────────────────────
    // Native <button> already routes Enter and Space to click events, so no
    // additional keyboard listener is needed (Requirement 6.6).
    this._button.addEventListener("click", this._handleClick);

    container.appendChild(this._button);
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  /** Toggles the quality mode on each activation. */
  private readonly _handleClick = (): void => {
    const nextMode: "default" | "eco" =
      this._state.qualityMode === "default" ? "eco" : "default";

    // Apply the new quality mode to the renderer within the same frame
    // (Requirement 6.7).
    this._renderer.setQualityMode(nextMode);

    // Update shared journey state.
    this._state.qualityMode = nextMode;

    // Reflect the new mode in the button's accessible state.
    this._button.setAttribute("aria-pressed", String(nextMode === "eco"));
    this._updateLabel();
  };

  /** Keeps the visible button label in sync with the current mode. */
  private _updateLabel(): void {
    this._button.textContent =
      this._state.qualityMode === "eco" ? "Quality: Eco" : "Quality: Default";
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * The underlying `<button>` element.
   * Exposed for testing and for potential external styling.
   */
  get button(): HTMLButtonElement {
    return this._button;
  }

  /**
   * Removes the button from the DOM and cleans up the click listener.
   * Call this when tearing down the journey.
   */
  destroy(): void {
    this._button.removeEventListener("click", this._handleClick);
    this._button.remove();
  }
}
