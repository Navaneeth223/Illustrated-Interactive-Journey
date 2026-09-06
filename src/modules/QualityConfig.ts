/**
 * QualityConfig — Phase 4 Stage B
 *
 * Single source of truth for what every Phase 3 system does under each
 * quality mode.  All Phase 3 modules import this and check it instead of
 * keeping their own flags.
 *
 * Default vs Eco comparison
 * ─────────────────────────
 * System                Default         Eco
 * Layer count           5               3 (skip sky + near-midground)
 * Blur filters          on              off (desaturate only)
 * Vertical parallax     on              off
 * Dust pool             20 particles    disabled (pool = 0)
 * NPC cap per segment   manifest value  max 2
 * Grain                 noise tile      flat 0.10 opacity sprite
 * Camera push/shake     on              on  (cheap, keep it)
 */

export type QualityMode = "default" | "eco";

export interface QualitySettings {
  mode: QualityMode;
  layerCount: 3 | 5;
  blurFiltersEnabled: boolean;
  verticalParallaxEnabled: boolean;
  dustPoolSize: number;
  npcCap: number;
  grainIsNoiseTile: boolean;
}

export const DEFAULT_QUALITY: QualitySettings = {
  mode: "default",
  layerCount: 5,
  blurFiltersEnabled: true,
  verticalParallaxEnabled: true,
  dustPoolSize: 20,
  npcCap: Infinity,
  grainIsNoiseTile: true,
};

export const ECO_QUALITY: QualitySettings = {
  mode: "eco",
  layerCount: 3,
  blurFiltersEnabled: false,
  verticalParallaxEnabled: false,
  dustPoolSize: 0,
  npcCap: 2,
  grainIsNoiseTile: false,
};

export function getQualitySettings(mode: QualityMode): QualitySettings {
  return mode === "eco" ? ECO_QUALITY : DEFAULT_QUALITY;
}
