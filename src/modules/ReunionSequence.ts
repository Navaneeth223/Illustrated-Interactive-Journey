/**
 * ReunionSequence — Phase 4 Stage D
 *
 * One orchestration function that choreographs the ending by calling into
 * existing systems — no new mechanics.
 *
 * Sequence (all simultaneous, staggered by small delays):
 *
 *   t=0.0s  timeScale eases to 0.25 (world slows)
 *   t=0.0s  Camera push-in (gentler than the default beat — 1.05×, 2.0s)
 *   t=0.5s  Atmospheric blur intensifies (bg blur 1.5 → 3.0)
 *   t=0.5s  Reunion swell audio fires
 *   t=1.0s  UI chrome fades out (quality HUD element)
 *   t=3.0s  ArrivalScreen fades in (after the moment has settled)
 *
 * The function is async and returns when the ArrivalScreen appears.
 * It is callable and independently testable — all dependencies are injected.
 */

import { gsap } from "gsap";
import type { CameraSystem } from "@/modules/CameraSystem";
import type { SoundEventBus } from "@/modules/SoundEventBus";
import type { AtmosphericDepth } from "@/modules/AtmosphericDepth";
import type { ArrivalScreen } from "@/modules/ArrivalScreen";

export interface ReunionDeps {
  camera:       CameraSystem;
  soundBus:     SoundEventBus;
  atmosphere:   AtmosphericDepth;
  arrivalScreen: ArrivalScreen;
  /** The DOM element housing the quality HUD — faded out during reunion. */
  hudElement:   HTMLElement | null;
  /** Callback to show the ArrivalScreen with the restart button. */
  onArrived:    () => void;
}

/**
 * Play the reunion ending sequence.
 *
 * This is the one place in the codebase where all Phase 3–4 systems are
 * orchestrated together.  Each call into existing APIs — nothing new is
 * built here, only composed.
 */
export async function playReunionSequence(deps: ReunionDeps): Promise<void> {
  const { camera, soundBus, atmosphere, hudElement, onArrived } = deps;

  // ── t = 0.0s ─────────────────────────────────────────────────────────────

  // Time scale eases to 0.25 — the world genuinely slows
  camera.setTimeScale(0.25, 2.5);

  // Gentle camera push-in (1.05×, 2.0s — softer than the breakdown beat)
  camera.pushIn(1.05, 2.0);

  // ── t = 0.5s ─────────────────────────────────────────────────────────────

  await delay(500);

  // Deepen atmospheric blur — focus-pull onto the reunion
  const bgBlurFilter = atmosphere.bgFilters.find(
    (f) => "blur" in (f as object)
  ) as { blur: number } | undefined;
  if (bgBlurFilter) {
    gsap.to(bgBlurFilter, { blur: 3.5, duration: 2.0, ease: "power2.inOut" });
  }

  // Reunion swell
  soundBus.fire("reunion-swell", 1.0);

  // ── t = 1.0s ─────────────────────────────────────────────────────────────

  await delay(500);

  // Fade out UI chrome
  if (hudElement) {
    gsap.to(hudElement, { opacity: 0, duration: 1.0, ease: "power2.inOut" });
  }

  // ── t = 3.0s ─────────────────────────────────────────────────────────────

  await delay(2000);

  // Show arrival screen — the moment has settled
  onArrived();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
