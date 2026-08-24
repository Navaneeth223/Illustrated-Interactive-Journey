/**
 * Unit tests for WebpFallback module.
 *
 * Tests the three exported utilities:
 *   - `detectWebpSupport()` — canvas-based feature detection
 *   - `rewriteWebpUrl(url)` — URL extension rewriter
 *   - `webpFallbackParser` — PixiJS LoadParser that intercepts .webp URLs
 *
 * WebP detection is mocked via vi.spyOn so tests are deterministic and
 * independent of the actual jsdom canvas behaviour.
 *
 * Requirements: 9.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module under test — imported AFTER mocks are set up in each test scope
// ---------------------------------------------------------------------------
import {
  detectWebpSupport,
  rewriteWebpUrl,
  webpFallbackParser,
} from "@/modules/WebpFallback";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake PixiJS loader whose `load` stub records its call. */
function makeLoader() {
  const load = vi.fn(async (url: string) => ({ url }));
  return { load };
}

// ---------------------------------------------------------------------------
// 1. rewriteWebpUrl
// ---------------------------------------------------------------------------

describe("rewriteWebpUrl()", () => {
  it("replaces .webp extension with .png", () => {
    expect(rewriteWebpUrl("assets/seg01/bg.webp")).toBe("assets/seg01/bg.png");
  });

  it("handles @0.5x suffix in the filename", () => {
    expect(rewriteWebpUrl("assets/seg01/bg@0.5x.webp")).toBe(
      "assets/seg01/bg@0.5x.png"
    );
  });

  it("leaves .png URLs unchanged", () => {
    expect(rewriteWebpUrl("assets/seg01/bg.png")).toBe("assets/seg01/bg.png");
  });

  it("leaves .jpg URLs unchanged", () => {
    expect(rewriteWebpUrl("assets/seg01/bg.jpg")).toBe("assets/seg01/bg.jpg");
  });

  it("leaves .mp3 URLs unchanged", () => {
    expect(rewriteWebpUrl("audio/ambient.mp3")).toBe("audio/ambient.mp3");
  });

  it("is case-insensitive for .WEBP", () => {
    expect(rewriteWebpUrl("assets/seg01/bg.WEBP")).toBe("assets/seg01/bg.png");
  });

  it("does not modify URLs with .webp in the middle of the path", () => {
    // .webp only at the end should be replaced — a segment named 'webp' in
    // a path should not be affected (the extension is terminal).
    const url = "assets/webp-assets/bg.png";
    expect(rewriteWebpUrl(url)).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// 2. detectWebpSupport — tests that jsdom canvas stubs behave predictably
// ---------------------------------------------------------------------------

describe("detectWebpSupport()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when document is unavailable", () => {
    // Temporarily hide `document` to simulate a non-browser environment.
    const orig = global.document;
    // @ts-expect-error — intentionally setting to undefined for testing
    global.document = undefined;
    expect(detectWebpSupport()).toBe(false);
    global.document = orig;
  });

  it("returns false when getContext returns null", () => {
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => null,
      toDataURL: () => "",
    } as unknown as HTMLCanvasElement);

    expect(detectWebpSupport()).toBe(false);
  });

  it("returns false when toDataURL does not return a webp data URL", () => {
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,ABC",
    } as unknown as HTMLCanvasElement);

    expect(detectWebpSupport()).toBe(false);
  });

  it("returns true when toDataURL returns a webp data URL", () => {
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/webp;base64,ABC",
    } as unknown as HTMLCanvasElement);

    expect(detectWebpSupport()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. webpFallbackParser.test() — applies only when WebP is NOT supported
// ---------------------------------------------------------------------------

describe("webpFallbackParser.test()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for a .webp URL when WebP is NOT supported", () => {
    // Simulate WebP not supported: toDataURL returns a png data URL
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,ABC",
    } as unknown as HTMLCanvasElement);

    expect(webpFallbackParser.test!("assets/seg01/bg.webp", null as never, null as never)).toBe(true);
  });

  it("returns false for a .webp URL when WebP IS supported", () => {
    // Simulate WebP supported: toDataURL returns a webp data URL
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/webp;base64,ABC",
    } as unknown as HTMLCanvasElement);

    expect(webpFallbackParser.test!("assets/seg01/bg.webp", null as never, null as never)).toBe(false);
  });

  it("returns false for a non-.webp URL regardless of WebP support", () => {
    // Even if WebP is not supported, .png and .jpg should not be intercepted
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,ABC",
    } as unknown as HTMLCanvasElement);

    expect(webpFallbackParser.test!("assets/seg01/bg.png", null as never, null as never)).toBe(false);
    expect(webpFallbackParser.test!("assets/seg01/bg.jpg", null as never, null as never)).toBe(false);
    expect(webpFallbackParser.test!("audio/ambient.mp3", null as never, null as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. webpFallbackParser.load() — rewrites URL to .png and delegates to loader
// ---------------------------------------------------------------------------

describe("webpFallbackParser.load()", () => {
  it("calls loader.load() with the .png equivalent URL", async () => {
    const loader = makeLoader();
    await webpFallbackParser.load!(
      "assets/seg01/bg.webp",
      {} as never,
      loader as never
    );

    expect(loader.load).toHaveBeenCalledOnce();
    const [calledUrl] = loader.load.mock.calls[0]!;
    expect(calledUrl).toBe("assets/seg01/bg.png");
  });

  it("rewrites @0.5x.webp URL to @0.5x.png", async () => {
    const loader = makeLoader();
    await webpFallbackParser.load!(
      "assets/seg01/bg@0.5x.webp",
      {} as never,
      loader as never
    );

    const [calledUrl] = loader.load.mock.calls[0]!;
    expect(calledUrl).toBe("assets/seg01/bg@0.5x.png");
  });

  it("returns whatever the delegate loader resolves with", async () => {
    const sentinel = { texture: "fake" };
    const loader = { load: vi.fn().mockResolvedValue(sentinel) };

    const result = await webpFallbackParser.load!(
      "assets/seg01/bg.webp",
      {} as never,
      loader as never
    );

    expect(result).toBe(sentinel);
  });
});
