import type { Container, Sprite } from "pixi.js";

/**
 * Static descriptor for a single scene segment, loaded from the manifest.
 */
export interface SegmentDescriptor {
  id: string;
  index: number;
  role: "departure" | "intermediate" | "arrival";
  widthPx: number;
  layers: {
    background: string;
    midground: string;
    foreground: string;
  };
  audioTrack: string;
  edgeMatchOffsetLeft: number;
  edgeMatchOffsetRight: number;
  /** 0–1 fraction of screen height where the ground line sits */
  groundLineRatio: number;
  /** Terrain type — drives dust particles */
  terrain?: "normal" | "dusty" | "water";
  /** Time of day — drives sun/moon position and bird density */
  timeOfDay?: "dawn" | "day" | "dusk" | "night";
  /** Ambient actors defined per-segment */
  npcs?: NpcDescriptor[];
}

export interface NpcDescriptor {
  type: "walker" | "swimmer" | "doorCycle";
  startX?: number;
  endX?: number;
  speed?: number;
  loop?: "pingpong" | "wrap";
  path?: [number, number][];
  doorX?: number;
  cycleSeconds?: number;
}

export interface JourneyManifest {
  segments: SegmentDescriptor[];
  maxVelocity: number;
  accelerationDuration: number;
  decelerationDuration: number;
  idleVolume: number;
  motionVolume: number;
  crossfadeDuration: number;
}

export interface JourneyState {
  worldPosition: number;
  currentSegmentIndex: number;
  phase: "gate" | "travelling" | "arrived";
  qualityMode: "default" | "eco";
  soundEnabled: boolean;
}

export interface SegmentInstance {
  descriptor: SegmentDescriptor;
  container: Container;
  bgSprite: Sprite;
  mgSprite: Sprite;
  fgSprite: Sprite;
  worldX: number;
  loaded: boolean;
  recycled: boolean;
}
