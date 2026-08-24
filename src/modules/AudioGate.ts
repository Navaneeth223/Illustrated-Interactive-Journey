import { Howler } from "howler";

/** Session-storage key used to persist the user's audio preference. */
const STORAGE_KEY = "ijj-audio-preference";

/** The two possible outcomes of the audio gate. */
export type AudioPreference = "sound-on" | "sound-off";

/**
 * AudioGate — blocking overlay that captures an explicit user gesture before
 * the journey begins, satisfying browser autoplay policy for Web Audio.
 *
 * Responsibilities:
 *  - `show()` renders a full-viewport modal overlay with two choices:
 *    "Enable sound" and "Continue without sound".
 *  - On "Enable sound": calls `Howler.ctx.resume()` inside the gesture handler
 *    so the AudioContext is unlocked within the same user event (Requirement 7.3).
 *  - On "Continue without sound": resolves immediately with `"sound-off"`
 *    (Requirement 7.4).
 *  - If `Howler.ctx.resume()` throws or rejects, resolves silently with
 *    `"sound-off"` — the gate does not re-display (Requirement 7.5).
 *  - `show()` checks `sessionStorage` first and returns any stored preference
 *    immediately without showing the overlay (Requirement 7.6).
 *  - The overlay is dismissed only by an explicit user button click — there is
 *    no auto-dismiss path (Requirement 7.2).
 *
 * Static helpers:
 *  - `getStoredPreference()` — reads the stored choice from `sessionStorage`.
 *  - `storePreference()` — writes the user's choice to `sessionStorage`.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
export class AudioGate {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** The root overlay element while it is mounted; null otherwise. */
  private _overlay: HTMLDivElement | null = null;

  /** The `<style>` tag injected into `<head>` for overlay CSS; null otherwise. */
  private _styleTag: HTMLStyleElement | null = null;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Present the audio-gate overlay and wait for an explicit user choice.
   *
   * Flow:
   *  1. If a stored preference exists in `sessionStorage`, return it
   *     immediately without rendering the overlay.
   *  2. Otherwise inject styles, build DOM, and return a `Promise` that
   *     resolves only when the user clicks one of the two buttons.
   *
   * The returned promise resolves with:
   *  - `"sound-on"`  — user clicked "Enable sound" and AudioContext resumed
   *                    (or attempted to resume — failure still yields `"sound-off"`)
   *  - `"sound-off"` — user clicked "Continue without sound", or AudioContext
   *                    activation failed
   *
   * @returns A promise that resolves with the user's audio preference.
   */
  async show(): Promise<AudioPreference> {
    // ── Check stored preference ──────────────────────────────────────────────
    const stored = AudioGate.getStoredPreference();
    if (stored !== null) {
      return stored;
    }

    // ── Build and mount the overlay ──────────────────────────────────────────
    return new Promise<AudioPreference>((resolve) => {
      this._injectStyles();
      this._overlay = this._buildOverlay(resolve);
      document.body.appendChild(this._overlay);

      // Focus the primary button after mount so keyboard users can act
      // immediately without additional Tab navigation.
      const primaryBtn =
        this._overlay.querySelector<HTMLButtonElement>("#ijj-gate-sound-on");
      primaryBtn?.focus();
    });
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /**
   * Read the user's stored audio preference from `sessionStorage`.
   *
   * The preference is keyed as `"ijj-audio-preference"` and is valid for the
   * current browser session only (Requirement 7.6).
   *
   * @returns `"sound-on"`, `"sound-off"`, or `null` if no preference is stored.
   */
  static getStoredPreference(): AudioPreference | null {
    try {
      const value = sessionStorage.getItem(STORAGE_KEY);
      if (value === "sound-on" || value === "sound-off") {
        return value;
      }
    } catch {
      // sessionStorage may be unavailable (private browsing restrictions, etc.)
      // Treat as no stored preference.
    }
    return null;
  }

  /**
   * Persist the user's audio preference to `sessionStorage` under the key
   * `"ijj-audio-preference"`.
   *
   * Silently no-ops if `sessionStorage` is unavailable.
   *
   * @param choice - The preference to store.
   */
  static storePreference(choice: AudioPreference): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // sessionStorage may be unavailable — treat as a silent failure.
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Inject a `<style>` tag into `<head>` containing all overlay CSS.
   *
   * Using a programmatic style tag avoids any external CSS file dependency and
   * ensures the styles are present exactly when the overlay is mounted.
   * The tag is removed in `_teardown()`.
   */
  private _injectStyles(): void {
    if (this._styleTag) return; // already injected

    const css = `
      /* ── AudioGate overlay ─────────────────────────────────────────────── */
      #ijj-audio-gate {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.82);
        color: #f0ece4;
        font-family: Georgia, "Times New Roman", serif;
        padding: 2rem;
        box-sizing: border-box;
      }

      #ijj-audio-gate-dialog {
        background: #1a1814;
        border: 1px solid rgba(240, 236, 228, 0.2);
        border-radius: 4px;
        padding: 2.5rem 2rem;
        max-width: 420px;
        width: 100%;
        text-align: center;
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
      }

      #ijj-audio-gate-title {
        font-size: 1.25rem;
        font-weight: normal;
        letter-spacing: 0.04em;
        margin: 0 0 0.75rem;
        color: #f0ece4;
      }

      #ijj-audio-gate-desc {
        font-size: 0.9rem;
        line-height: 1.6;
        color: rgba(240, 236, 228, 0.7);
        margin: 0 0 2rem;
      }

      .ijj-gate-btn {
        display: block;
        width: 100%;
        padding: 0.75rem 1rem;
        border: 1px solid rgba(240, 236, 228, 0.35);
        border-radius: 3px;
        background: transparent;
        color: #f0ece4;
        font-family: inherit;
        font-size: 0.95rem;
        letter-spacing: 0.03em;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
        margin-bottom: 0.75rem;
      }

      .ijj-gate-btn:last-child {
        margin-bottom: 0;
      }

      .ijj-gate-btn:hover,
      .ijj-gate-btn:focus {
        background: rgba(240, 236, 228, 0.1);
        border-color: rgba(240, 236, 228, 0.65);
        outline: none;
      }

      .ijj-gate-btn:focus-visible {
        outline: 2px solid rgba(240, 236, 228, 0.8);
        outline-offset: 2px;
      }

      #ijj-gate-sound-on {
        border-color: rgba(240, 236, 228, 0.55);
      }
    `;

    this._styleTag = document.createElement("style");
    this._styleTag.textContent = css;
    document.head.appendChild(this._styleTag);
  }

  /**
   * Construct the overlay DOM tree.
   *
   * The overlay uses ARIA attributes to expose its semantics to assistive
   * technology:
   *  - `role="dialog"` on the root element
   *  - `aria-modal="true"` to indicate it is a modal dialog
   *  - `aria-labelledby` pointing to the heading element
   *  - `aria-describedby` pointing to the description element
   *
   * Both action buttons are native `<button>` elements so they are keyboard-
   * reachable and activated by Enter/Space without custom key handlers.
   *
   * @param resolve - The promise resolver to call when a choice is made.
   * @returns The fully-constructed overlay `<div>`.
   */
  private _buildOverlay(
    resolve: (choice: AudioPreference) => void
  ): HTMLDivElement {
    // ── Root backdrop ────────────────────────────────────────────────────────
    const backdrop = document.createElement("div");
    backdrop.id = "ijj-audio-gate";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "ijj-audio-gate-title");
    backdrop.setAttribute("aria-describedby", "ijj-audio-gate-desc");

    // ── Inner dialog card ────────────────────────────────────────────────────
    const card = document.createElement("div");
    card.id = "ijj-audio-gate-dialog";

    // ── Heading ──────────────────────────────────────────────────────────────
    const heading = document.createElement("h2");
    heading.id = "ijj-audio-gate-title";
    heading.textContent = "Before you begin";

    // ── Description ─────────────────────────────────────────────────────────
    const desc = document.createElement("p");
    desc.id = "ijj-audio-gate-desc";
    desc.textContent =
      "This journey includes ambient audio. Would you like to enable sound?";

    // ── "Enable sound" button ────────────────────────────────────────────────
    const soundOnBtn = document.createElement("button");
    soundOnBtn.id = "ijj-gate-sound-on";
    soundOnBtn.className = "ijj-gate-btn";
    soundOnBtn.type = "button";
    soundOnBtn.textContent = "Enable sound";

    soundOnBtn.addEventListener("click", () => {
      void this._handleSoundOn(resolve);
    });

    // ── "Continue without sound" button ─────────────────────────────────────
    const soundOffBtn = document.createElement("button");
    soundOffBtn.id = "ijj-gate-sound-off";
    soundOffBtn.className = "ijj-gate-btn";
    soundOffBtn.type = "button";
    soundOffBtn.textContent = "Continue without sound";

    soundOffBtn.addEventListener("click", () => {
      AudioGate.storePreference("sound-off");
      this._teardown();
      resolve("sound-off");
    });

    // ── Assemble ─────────────────────────────────────────────────────────────
    card.appendChild(heading);
    card.appendChild(desc);
    card.appendChild(soundOnBtn);
    card.appendChild(soundOffBtn);
    backdrop.appendChild(card);

    return backdrop;
  }

  /**
   * Handle the "Enable sound" button click.
   *
   * Calls `Howler.ctx.resume()` synchronously within the user-gesture event
   * so that browsers honour the autoplay policy.  If the resume call throws or
   * the returned promise rejects, the journey continues silently (`"sound-off"`)
   * — the gate does not re-display (Requirement 7.5).
   *
   * @param resolve - The promise resolver from `show()`.
   */
  private async _handleSoundOn(
    resolve: (choice: AudioPreference) => void
  ): Promise<void> {
    try {
      // `Howler.ctx` is the underlying `AudioContext`.
      // Calling `.resume()` inside a click handler satisfies browser autoplay
      // policy because we are within a trusted user gesture (Requirement 7.3).
      await Howler.ctx.resume();
      AudioGate.storePreference("sound-on");
      this._teardown();
      resolve("sound-on");
    } catch {
      // AudioContext activation failed — proceed silently (Requirement 7.5).
      AudioGate.storePreference("sound-off");
      this._teardown();
      resolve("sound-off");
    }
  }

  /**
   * Remove the overlay and its associated style tag from the DOM.
   *
   * Called by both button handlers once a choice has been made.
   */
  private _teardown(): void {
    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;

    if (this._styleTag && this._styleTag.parentNode) {
      this._styleTag.parentNode.removeChild(this._styleTag);
    }
    this._styleTag = null;
  }

  // -------------------------------------------------------------------------
  // Internal accessors (exposed for testing)
  // -------------------------------------------------------------------------

  /** @internal Exposes the overlay element for unit tests. */
  get _overlayForTesting(): HTMLDivElement | null {
    return this._overlay;
  }

  /** @internal Exposes the style tag for unit tests. */
  get _styleTagForTesting(): HTMLStyleElement | null {
    return this._styleTag;
  }
}
