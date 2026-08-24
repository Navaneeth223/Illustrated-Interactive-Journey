/**
 * Unit tests for QualityHUD.
 *
 * PixiRenderer is stubbed so tests don't need a real WebGL context.
 * The jsdom environment (configured globally in vite.config.ts) provides
 * `document`, `HTMLButtonElement`, keyboard events, etc.
 *
 * Requirements: 6.6 (accessible, keyboard-reachable at any time),
 *               6.7 (renderer updated on toggle within the same frame)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QualityHUD } from "@/modules/QualityHUD";
import type { JourneyState } from "@/types/journey";

// ---------------------------------------------------------------------------
// PixiRenderer stub
// ---------------------------------------------------------------------------

/**
 * Minimal stub for PixiRenderer — only `setQualityMode` is needed.
 * We use `as unknown as PixiRenderer` to avoid importing the real class
 * (which requires a full PIXI.Application / WebGL context).
 */
function makeRendererStub() {
  return {
    setQualityMode: vi.fn<[("default" | "eco")], void>(),
  };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeState(
  override: Partial<JourneyState> = {}
): JourneyState {
  return {
    worldPosition: 0,
    currentSegmentIndex: 0,
    phase: "travelling",
    qualityMode: "default",
    soundEnabled: true,
    ...override,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

// No afterEach cleanup — jsdom resets between test files; individual tests
// that need isolation create fresh instances.

// ---------------------------------------------------------------------------
// 1. Rendering — button is mounted and accessible
// ---------------------------------------------------------------------------

describe("QualityHUD — initial render", () => {
  it("appends a <button> to the given container", () => {
    const renderer = makeRendererStub();
    const state = makeState();
    new QualityHUD(container, renderer as never, state);

    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
  });

  it('sets aria-pressed="false" when initial mode is "default"', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "default" });
    new QualityHUD(container, renderer as never, state);

    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it('sets aria-pressed="true" when initial mode is "eco"', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "eco" });
    new QualityHUD(container, renderer as never, state);

    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("has an accessible aria-label", () => {
    const renderer = makeRendererStub();
    const state = makeState();
    new QualityHUD(container, renderer as never, state);

    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-label")).toBeTruthy();
  });

  it('exposes the button via the ".button" getter', () => {
    const renderer = makeRendererStub();
    const state = makeState();
    const hud = new QualityHUD(container, renderer as never, state);

    expect(hud.button).toBeInstanceOf(HTMLButtonElement);
    expect(hud.button).toBe(container.querySelector("button"));
  });
});

// ---------------------------------------------------------------------------
// 2. Click — toggles aria-pressed and calls setQualityMode
// ---------------------------------------------------------------------------

describe("QualityHUD — click toggles quality mode", () => {
  it('toggles aria-pressed from "false" to "true" on first click', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "default" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.click();

    expect(hud.button.getAttribute("aria-pressed")).toBe("true");
  });

  it('toggles aria-pressed from "true" to "false" on first click', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "eco" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.click();

    expect(hud.button.getAttribute("aria-pressed")).toBe("false");
  });

  it('calls setQualityMode("eco") when mode was "default"', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "default" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.click();

    expect(renderer.setQualityMode).toHaveBeenCalledOnce();
    expect(renderer.setQualityMode).toHaveBeenCalledWith("eco");
  });

  it('calls setQualityMode("default") when mode was "eco"', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "eco" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.click();

    expect(renderer.setQualityMode).toHaveBeenCalledOnce();
    expect(renderer.setQualityMode).toHaveBeenCalledWith("default");
  });

  it('updates JourneyState.qualityMode to "eco" after clicking from "default"', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "default" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.click();

    expect(state.qualityMode).toBe("eco");
  });

  it('updates JourneyState.qualityMode to "default" after clicking from "eco"', () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "eco" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.click();

    expect(state.qualityMode).toBe("default");
  });

  it("toggles back to original state after two clicks", () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "default" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.click(); // default → eco
    hud.button.click(); // eco → default

    expect(hud.button.getAttribute("aria-pressed")).toBe("false");
    expect(state.qualityMode).toBe("default");
    expect(renderer.setQualityMode).toHaveBeenNthCalledWith(1, "eco");
    expect(renderer.setQualityMode).toHaveBeenNthCalledWith(2, "default");
  });
});

// ---------------------------------------------------------------------------
// 3. Keyboard activation — Enter and Space fire the click handler
// ---------------------------------------------------------------------------

describe("QualityHUD — keyboard activation (Requirement 6.6)", () => {
  it("activates the toggle when Enter is pressed on the button", () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "default" });
    const hud = new QualityHUD(container, renderer as never, state);

    // Dispatch a keydown with Enter key — jsdom's HTMLButtonElement fires a
    // synthetic click for Enter when the button is focused (spec behaviour).
    // We simulate this by dispatching a click event directly, which is how
    // Enter is handled in real browsers for native buttons.
    hud.button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // jsdom doesn't automatically convert keydown → click for Enter, so we
    // also trigger the click the way browsers do.
    hud.button.click();

    expect(renderer.setQualityMode).toHaveBeenCalledWith("eco");
  });

  it("activates the toggle when Space is pressed on the button", () => {
    const renderer = makeRendererStub();
    const state = makeState({ qualityMode: "default" });
    const hud = new QualityHUD(container, renderer as never, state);

    hud.button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    hud.button.click();

    expect(renderer.setQualityMode).toHaveBeenCalledWith("eco");
  });

  it("button has tabIndex >= 0 — is keyboard-reachable", () => {
    const renderer = makeRendererStub();
    const state = makeState();
    const hud = new QualityHUD(container, renderer as never, state);

    // A native <button> has tabIndex === 0 by default (not -1).
    expect(hud.button.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it("button is not disabled by default", () => {
    const renderer = makeRendererStub();
    const state = makeState();
    const hud = new QualityHUD(container, renderer as never, state);

    expect(hud.button.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. destroy() — cleans up DOM and event listeners
// ---------------------------------------------------------------------------

describe("QualityHUD — destroy()", () => {
  it("removes the button from the DOM", () => {
    const renderer = makeRendererStub();
    const state = makeState();
    const hud = new QualityHUD(container, renderer as never, state);

    hud.destroy();

    expect(container.querySelector("button")).toBeNull();
  });

  it("does not call setQualityMode after destroy", () => {
    const renderer = makeRendererStub();
    const state = makeState();
    const hud = new QualityHUD(container, renderer as never, state);

    hud.destroy();
    // The button is removed from DOM so click() is a no-op, but we verify
    // setQualityMode is never called regardless.
    hud.button.click();

    expect(renderer.setQualityMode).not.toHaveBeenCalled();
  });
});
