/**
 * Unit tests for AudioGate.
 *
 * Howler is stubbed so `Howler.ctx.resume` is a controllable vi.fn().
 * The jsdom environment (configured globally in vite.config.ts) provides
 * `document`, `sessionStorage`, etc.
 *
 * Requirements: 7.6 (session-storage bypass), 7.2 (explicit click only),
 *               7.3 (sound-on path), 7.4 (sound-off path), 7.5 (silent failure)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioGate } from "@/modules/AudioGate";
import type { AudioPreference } from "@/modules/AudioGate";

// ---------------------------------------------------------------------------
// Howler stub
// ---------------------------------------------------------------------------

/**
 * Use vi.hoisted() so the object is available inside the vi.mock() factory
 * (which is hoisted to the top of the file by Vitest's transform).
 * Individual tests replace `ctx.resume` via `mockHowler.resume`.
 */
const mockHowler = vi.hoisted(() => ({
  resume: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("howler", () => ({
  Howler: {
    get ctx() {
      return { resume: mockHowler.resume };
    },
  },
  // Stub Howl so that other modules importing howler don't break.
  Howl: vi.fn().mockImplementation(() => ({
    play: vi.fn().mockReturnValue(0),
    stop: vi.fn().mockReturnThis(),
    fade: vi.fn().mockReturnThis(),
    volume: vi.fn().mockReturnThis(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ijj-audio-preference";

function clearStorage(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Click a button inside the overlay by its id, after microtasks flush. */
async function clickButton(id: string): Promise<void> {
  await Promise.resolve(); // let show() mount the overlay
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (!btn) throw new Error(`Button #${id} not found in DOM`);
  btn.click();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearStorage();
  // Reset resume mock to a simple resolved promise before each test.
  mockHowler.resume = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
  // Clean up any leftover overlay nodes (defensive).
  document.getElementById("ijj-audio-gate")?.remove();
  document.querySelector("style[data-gate]")?.remove();
});

afterEach(() => {
  clearStorage();
  document.getElementById("ijj-audio-gate")?.remove();
});

// ---------------------------------------------------------------------------
// 1. getStoredPreference() — empty storage
// ---------------------------------------------------------------------------

describe("AudioGate.getStoredPreference() — empty storage", () => {
  it("returns null when sessionStorage has no entry", () => {
    expect(AudioGate.getStoredPreference()).toBeNull();
  });

  it("returns null when sessionStorage has an unrecognised value", () => {
    sessionStorage.setItem(STORAGE_KEY, "invalid-value");
    expect(AudioGate.getStoredPreference()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. getStoredPreference() — value present
// ---------------------------------------------------------------------------

describe("AudioGate.getStoredPreference() — value present", () => {
  it('returns "sound-on" when that value is stored', () => {
    sessionStorage.setItem(STORAGE_KEY, "sound-on");
    expect(AudioGate.getStoredPreference()).toBe("sound-on");
  });

  it('returns "sound-off" when that value is stored', () => {
    sessionStorage.setItem(STORAGE_KEY, "sound-off");
    expect(AudioGate.getStoredPreference()).toBe("sound-off");
  });
});

// ---------------------------------------------------------------------------
// 3. storePreference() — writes to sessionStorage
// ---------------------------------------------------------------------------

describe("AudioGate.storePreference()", () => {
  it('writes "sound-on" to sessionStorage', () => {
    AudioGate.storePreference("sound-on");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sound-on");
  });

  it('writes "sound-off" to sessionStorage', () => {
    AudioGate.storePreference("sound-off");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sound-off");
  });

  it("overwrites a previous value", () => {
    AudioGate.storePreference("sound-on");
    AudioGate.storePreference("sound-off");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sound-off");
  });
});

// ---------------------------------------------------------------------------
// 4. show() — bypass path (stored preference)
// ---------------------------------------------------------------------------

describe("AudioGate.show() — session-storage bypass (Requirement 7.6)", () => {
  it('resolves immediately with "sound-on" without rendering the overlay', async () => {
    sessionStorage.setItem(STORAGE_KEY, "sound-on");
    const gate = new AudioGate();

    const result = await gate.show();

    expect(result).toBe("sound-on");
    expect(document.getElementById("ijj-audio-gate")).toBeNull();
  });

  it('resolves immediately with "sound-off" without rendering the overlay', async () => {
    sessionStorage.setItem(STORAGE_KEY, "sound-off");
    const gate = new AudioGate();

    const result = await gate.show();

    expect(result).toBe("sound-off");
    expect(document.getElementById("ijj-audio-gate")).toBeNull();
  });

  it("does not touch sessionStorage when returning a cached preference", async () => {
    sessionStorage.setItem(STORAGE_KEY, "sound-on");
    const gate = new AudioGate();
    await gate.show();
    // Value must remain unchanged — show() must not overwrite.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sound-on");
  });
});

// ---------------------------------------------------------------------------
// 5. show() — renders overlay when no preference is stored
// ---------------------------------------------------------------------------

describe("AudioGate.show() — overlay rendered when no preference (Requirement 7.2)", () => {
  it("mounts the overlay element to the document body", async () => {
    const gate = new AudioGate();
    const _promise = gate.show(); // don't await — overlay must stay open
    await Promise.resolve(); // flush microtasks so show() runs past the check
    expect(document.getElementById("ijj-audio-gate")).not.toBeNull();
    // Clean up: click sound-off to resolve
    document.getElementById("ijj-gate-sound-off")?.click();
    await _promise;
  });

  it("mounts both action buttons", async () => {
    const gate = new AudioGate();
    const _promise = gate.show();
    await Promise.resolve();
    expect(document.getElementById("ijj-gate-sound-on")).not.toBeNull();
    expect(document.getElementById("ijj-gate-sound-off")).not.toBeNull();
    document.getElementById("ijj-gate-sound-off")?.click();
    await _promise;
  });

  it("overlay has role=dialog for accessibility", async () => {
    const gate = new AudioGate();
    const _promise = gate.show();
    await Promise.resolve();
    const overlay = document.getElementById("ijj-audio-gate");
    expect(overlay?.getAttribute("role")).toBe("dialog");
    document.getElementById("ijj-gate-sound-off")?.click();
    await _promise;
  });
});

// ---------------------------------------------------------------------------
// 6. "Enable sound" path — resolves with "sound-on" and persists
// ---------------------------------------------------------------------------

describe('AudioGate.show() — "Enable sound" path (Requirements 7.3, 7.6)', () => {
  it('resolves with "sound-on" when AudioContext resumes successfully', async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-on");
    const result = await promise;

    expect(result).toBe("sound-on");
  });

  it('persists "sound-on" to sessionStorage', async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-on");
    await promise;

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sound-on");
  });

  it("removes the overlay from the DOM after resolving", async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-on");
    await promise;

    expect(document.getElementById("ijj-audio-gate")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. "Continue without sound" path — resolves with "sound-off" and persists
// ---------------------------------------------------------------------------

describe('AudioGate.show() — "Continue without sound" path (Requirements 7.4, 7.6)', () => {
  it('resolves with "sound-off"', async () => {
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-off");
    const result = await promise;

    expect(result).toBe("sound-off");
  });

  it('persists "sound-off" to sessionStorage', async () => {
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-off");
    await promise;

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sound-off");
  });

  it("removes the overlay from the DOM after resolving", async () => {
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-off");
    await promise;

    expect(document.getElementById("ijj-audio-gate")).toBeNull();
  });

  it("does not call Howler.ctx.resume", async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-off");
    await promise;

    expect(mockHowler.resume).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Silent failure path — Howler.ctx.resume throws → "sound-off", no re-display
// ---------------------------------------------------------------------------

describe('AudioGate.show() — silent failure path (Requirement 7.5)', () => {
  it('resolves with "sound-off" when resume() throws synchronously', async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockRejectedValue(new Error("AudioContext blocked"));
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-on");
    const result = await promise;

    expect(result).toBe("sound-off");
  });

  it('persists "sound-off" to sessionStorage on resume() failure', async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockRejectedValue(new Error("AudioContext blocked"));
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-on");
    await promise;

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("sound-off");
  });

  it("removes the overlay from the DOM (gate does not re-display)", async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockRejectedValue(new Error("AudioContext blocked"));
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-on");
    await promise;

    expect(document.getElementById("ijj-audio-gate")).toBeNull();
  });

  it("gate resolves only once — promise does not stay pending", async () => {
    mockHowler.resume = vi.fn<[], Promise<void>>().mockRejectedValue(new Error("AudioContext blocked"));
    const gate = new AudioGate();
    const promise = gate.show();

    await clickButton("ijj-gate-sound-on");

    // If the promise is still pending after a tick this will time-out.
    const result = await Promise.race([
      promise,
      new Promise<AudioPreference>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), 500)
      ),
    ]);

    expect(result).toBe("sound-off");
  });
});
