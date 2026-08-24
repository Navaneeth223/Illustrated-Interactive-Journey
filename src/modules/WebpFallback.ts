/**
 * WebpFallback.ts — PixiJS `loadParser` that rewrites `.webp` URLs to `.png`
 * when the browser does not support WebP.
 *
 * ## How it works
 *
 * 1. `detectWebpSupport()` performs a synchronous canvas-based probe:
 *    - Creates a 1×1 `<canvas>`, encodes it as `image/webp`, and checks
 *      whether the resulting data URL actually starts with `data:image/webp`.
 *    - Falls back to `false` if `canvas` / `getContext` is unavailable
 *      (e.g., Node.js / headless environments without canvas support).
 *
 * 2. `rewriteWebpUrl(url)` replaces the `.webp` extension with `.png`,
 *    leaving all other extensions untouched.
 *
 * 3. `webpFallbackParser` is a PixiJS v8 `LoadParser` whose `load` hook
 *    intercepts any `.webp` URL when WebP is not supported and transparently
 *    redirects the load to the corresponding `.png` file.
 *
 * 4. `registerWebpFallback()` adds the parser to the PixiJS `extensions`
 *    system, making it active for all subsequent `Assets.load()` calls.
 *
 * Requirements: 9.1
 */

import { extensions, ExtensionType } from "pixi.js";
import type { LoaderParser, ResolvedAsset, Loader } from "pixi.js";

// ---------------------------------------------------------------------------
// WebP detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the current environment supports WebP image encoding.
 *
 * Uses a synchronous canvas `toDataURL('image/webp')` probe — the lightest
 * detection method that works in all modern browsers.  Returns `false` in
 * any environment where `document`, `canvas`, or `getContext('2d')` is
 * unavailable.
 */
export function detectWebpSupport(): boolean {
  try {
    if (typeof document === "undefined") return false;

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const dataUrl = canvas.toDataURL("image/webp");
    return dataUrl.startsWith("data:image/webp");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// URL rewriter
// ---------------------------------------------------------------------------

/**
 * Replaces the `.webp` file extension in `url` with `.png`.
 *
 * URLs that do not end with `.webp` are returned unchanged.
 *
 * @example
 *   rewriteWebpUrl("assets/seg01/bg.webp")      // → "assets/seg01/bg.png"
 *   rewriteWebpUrl("assets/seg01/bg@0.5x.webp") // → "assets/seg01/bg@0.5x.png"
 *   rewriteWebpUrl("assets/seg01/bg.png")        // → "assets/seg01/bg.png"
 *   rewriteWebpUrl("assets/seg01/bg.jpg")        // → "assets/seg01/bg.jpg"
 */
export function rewriteWebpUrl(url: string): string {
  return url.replace(/\.webp$/i, ".png");
}

// ---------------------------------------------------------------------------
// LoadParser
// ---------------------------------------------------------------------------

/**
 * PixiJS v8 `LoadParser` that rewrites `.webp` URLs to `.png` when the
 * browser does not natively support WebP.
 *
 * The parser is implemented as a *pre-load transform*: it intercepts the URL
 * in the `config.url` property before any network request is issued by the
 * default texture loader.  When WebP IS supported, the parser is a no-op and
 * the URL passes through unmodified.
 *
 * ### Integration
 *
 * Register once at application startup via `registerWebpFallback()`.  After
 * registration every `Assets.load('…something….webp')` call will
 * automatically resolve to the `.png` equivalent on non-WebP browsers.
 *
 * Requirements: 9.1
 */
export const webpFallbackParser: LoaderParser = {
  name: "webp-fallback-parser",
  id: "webp-fallback-parser",
  extension: {
      type: ExtensionType.LoadParser,
      name: "webp-fallback-parser",
    },

  /**
   * This parser applies only to `.webp` URLs when WebP is not supported.
   * Returning `false` here lets other parsers handle the asset as normal.
   */
  test(url: string): boolean {
    return /\.webp$/i.test(url) && !detectWebpSupport();
  },

  /**
   * Load the asset using the fallback `.png` URL.
   *
   * Delegates to the built-in `fetch`-based loader after rewriting the URL,
   * so all standard PixiJS caching and error-handling behaviour is preserved.
   */
  async load<T>(url: string, _resolvedAsset?: ResolvedAsset, loader?: Loader): Promise<T> {
    const pngUrl = rewriteWebpUrl(url);
    return loader!.load<T>(pngUrl);
  },
};

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Registers `webpFallbackParser` with the PixiJS extension system.
 *
 * Call this once during application initialisation, before any `Assets.load()`
 * call, to ensure the fallback is active for the entire session.
 *
 * ```typescript
 * import { registerWebpFallback } from "@/modules/WebpFallback";
 * registerWebpFallback();
 * // … then proceed with Assets.load() calls …
 * ```
 *
 * Requirements: 9.1
 */
export function registerWebpFallback(): void {
  extensions.add(webpFallbackParser);
}
