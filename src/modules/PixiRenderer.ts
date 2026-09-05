/**
 * PixiRenderer — composites all scene layers, runs post-process, and owns
 * the cyclist rig plus all Stage A–D subsystems.
 *
 * Stage A: CyclistRig (full jointed rig, replaces the old static Graphics)
 * Stage B: AtmosphericDepth (per-layer blur/desaturate + vertical pointer parallax
 *          + foreground occlusion layer)
 * Stage C: WindSystem, SunMoonActor, DustSystem
 * Stage D: NpcSystem (manifest-driven ambient actors)
 */

import * as PIXI from "pixi.js";
import { GlProgram } from "pixi.js";
import { UniformGroup } from "pixi.js";
import type { SegmentInstance } from "@/types/journey";
import { CyclistRig } from "@/modules/CyclistRig";
import { AtmosphericDepth } from "@/modules/AtmosphericDepth";
import { WindSystem } from "@/modules/WindSystem";
import { SunMoonActor } from "@/modules/SunMoonActor";
import { DustSystem } from "@/modules/DustSystem";
import { NpcSystem } from "@/modules/NpcSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toHalfResUrl(url: string): string {
  if (url.includes("@0.5x")) return url;
  return url.replace(/(\.[^./]+)$/, "@0.5x$1");
}

function toFullResUrl(url: string): string {
  return url.replace("@0.5x", "");
}

// ---------------------------------------------------------------------------
// PixiRenderer
// ---------------------------------------------------------------------------

export class PixiRenderer {
  // ── Private state ─────────────────────────────────────────────────────────

  private readonly _app: PIXI.Application;

  /** Five parallax layers — sky(0.05×) bg(0.15×) mg(0.35×) nmg(0.6×) fg(1.0×) */
  private readonly _skyContainer: PIXI.Container;
  private readonly _bgContainer:  PIXI.Container;
  private readonly _mgContainer:  PIXI.Container;
  private readonly _nmgContainer: PIXI.Container;  // near-midground
  private readonly _fgContainer:  PIXI.Container;

  private readonly _addedBg:  Set<PIXI.Sprite> = new Set();
  private readonly _addedMg:  Set<PIXI.Sprite> = new Set();
  private readonly _addedFg:  Set<PIXI.Sprite> = new Set();

  private readonly _nativeDPR: number;
  private readonly _trackedSegments: Set<SegmentInstance> = new Set();

  // Ground line
  private _groundLineRatio: number = 0.72;

  // Grain animation offsets
  private _grainOffsetX: number = 0;
  private _grainOffsetY: number = 0;

  // Stage A — jointed rig
  private readonly _cyclistRig: CyclistRig;

  // Stage B — atmospheric depth + vertical parallax + occlusion
  private readonly _atmosphericDepth: AtmosphericDepth;

  // Stage C subsystems
  readonly wind:    WindSystem;   // public — trees/particles read wind.intensity
  private readonly _sunMoon: SunMoonActor;
  private readonly _dust:    DustSystem;

  // Stage D — NPCs
  private readonly _npcs: NpcSystem;

  // Segment tracking (for segment-change events)
  private _currentSegmentIndex: number = -1;

  // ── Public post-process handles ───────────────────────────────────────────

  readonly postProcess: {
    grainSprite: PIXI.Sprite;
    vignetteFilter: PIXI.Filter;
    grayscaleFilter: PIXI.ColorMatrixFilter;
  };

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(app: PIXI.Application) {
    this._app = app;
    this._nativeDPR = Math.min(window.devicePixelRatio ?? 1, 2);
    this._app.renderer.resolution = this._nativeDPR;

    // ── Stage C: Wind + Sun/moon (behind everything) ────────────────────
    this.wind     = new WindSystem();
    this._sunMoon = new SunMoonActor(app);
    this._app.stage.addChild(this._sunMoon.container);

    // ── Five parallax layer containers ───────────────────────────────────
    this._skyContainer = new PIXI.Container();
    this._bgContainer  = new PIXI.Container();
    this._mgContainer  = new PIXI.Container();
    this._nmgContainer = new PIXI.Container();
    this._fgContainer  = new PIXI.Container();

    this._app.stage.addChild(this._skyContainer);
    this._app.stage.addChild(this._bgContainer);
    this._app.stage.addChild(this._mgContainer);
    this._app.stage.addChild(this._nmgContainer);
    this._app.stage.addChild(this._fgContainer);

    // ── Stage B: atmospheric depth filters ───────────────────────────────
    this._atmosphericDepth = new AtmosphericDepth(app);
    this._atmosphericDepth.applyFilters(this._bgContainer, this._mgContainer);

    // ── Stage D: NPCs (world-space, at foreground level) ──────────────────
    this._npcs = new NpcSystem();
    this._app.stage.addChild(this._npcs.container);

    // ── Stage A: cyclist rig ─────────────────────────────────────────────
    this._cyclistRig = new CyclistRig();
    this._app.stage.addChild(this._cyclistRig.parts.root);
    this._positionCyclist();

    // ── Stage B: occlusion layer (above cyclist) ──────────────────────────
    this._app.stage.addChild(this._atmosphericDepth.occlusionContainer);

    // ── Stage C: dust particles (above occlusion) ─────────────────────────
    this._dust = new DustSystem();
    this._app.stage.addChild(this._dust.container);

    // ── Animated grain (TilingSprite) ────────────────────────────────────
    const grainTex = this._generateGrainTexture();
    const grainSprite = new PIXI.TilingSprite({
      texture: grainTex,
      width:  this._app.screen.width,
      height: this._app.screen.height,
    });
    grainSprite.blendMode = "multiply";
    grainSprite.alpha = 0.42;
    this._app.stage.addChild(grainSprite);

    // ── Grayscale filter ─────────────────────────────────────────────────
    const grayscaleFilter = new PIXI.ColorMatrixFilter();
    grayscaleFilter.grayscale(1, false);

    // ── Vignette filter ──────────────────────────────────────────────────
    const vignetteVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}`;

    const vignetteFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uSampler;
uniform float uStrength;
uniform float uSoftness;
void main(void) {
  vec4 color = texture(uSampler, vTextureCoord);
  vec2 uv = vTextureCoord * 2.0 - 1.0;
  float dist = length(uv);
  float vignette = smoothstep(uStrength, uStrength - uSoftness, dist);
  finalColor = vec4(color.rgb * vignette, color.a);
}`;

    const vignetteGlProgram = GlProgram.from({
      vertex: vignetteVertex,
      fragment: vignetteFragment,
      name: "vignette-filter",
    });

    const vignetteUniforms = new UniformGroup({
      uStrength: { value: 1.4, type: "f32" as const },
      uSoftness: { value: 0.6, type: "f32" as const },
    });

    const vignetteFilter = new PIXI.Filter({
      glProgram: vignetteGlProgram,
      resources: { vignetteUniforms },
    });

    this._app.stage.filters = [grayscaleFilter, vignetteFilter];

    this.postProcess = {
      grainSprite: grainSprite as unknown as PIXI.Sprite,
      vignetteFilter,
      grayscaleFilter,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Called each rAF tick by JourneyController.
   * @param worldPosition  Scroll position in world pixels.
   * @param velocity       Current velocity from VelocityModel (signed px/s).
   * @param segments       Active segment instances.
   */
  render(worldPosition: number, velocity: number, segments: SegmentInstance[]): void {
    // ── Parallax horizontal positioning ──────────────────────────────────
    this._skyContainer.x = (-worldPosition * 0.05)  || 0;
    this._bgContainer.x  = (-worldPosition * 0.15)  || 0;
    this._mgContainer.x  = (-worldPosition * 0.35)  || 0;
    this._nmgContainer.x = (-worldPosition * 0.60)  || 0;
    this._fgContainer.x  = (-worldPosition * 1.00)  || 0;

    // ── Stage B: vertical parallax ────────────────────────────────────────
    this._atmosphericDepth.applyVerticalParallax(
      this._bgContainer,
      this._mgContainer,
      this._fgContainer,
    );

    // ── Stage B: occlusion container scrolls at 1.0× ──────────────────────
    this._atmosphericDepth.updateOcclusion(worldPosition);

    // ── Add segment sprites (idempotent) ─────────────────────────────────
    for (const segment of segments) {
      this._trackedSegments.add(segment);
      if (!this._addedBg.has(segment.bgSprite)) {
        this._bgContainer.addChild(segment.bgSprite);
        this._addedBg.add(segment.bgSprite);
      }
      if (!this._addedMg.has(segment.mgSprite)) {
        this._mgContainer.addChild(segment.mgSprite);
        this._addedMg.add(segment.mgSprite);
      }
      if (!this._addedFg.has(segment.fgSprite)) {
        this._fgContainer.addChild(segment.fgSprite);
        this._addedFg.add(segment.fgSprite);
      }
    }

    // ── Stage A: animate cyclist ──────────────────────────────────────────
    this._cyclistRig.update(velocity, 1 / 60);

    // ── Stage C: sun/moon ─────────────────────────────────────────────────
    this._sunMoon.update();

    // ── Stage C: dust (emit near rear wheel contact) ──────────────────────
    const rearWheelScreenX = this._cyclistRig.parts.root.x - 28 * 1.6;
    const rearWheelScreenY = this._cyclistRig.parts.root.y;
    this._dust.update(velocity, 1 / 60, rearWheelScreenX, rearWheelScreenY);

    // ── Stage D: NPCs ─────────────────────────────────────────────────────
    const currentSeg = this._getCurrentSegment(worldPosition, segments);
    if (currentSeg) {
      const segIdx = currentSeg.descriptor.index;
      if (segIdx !== this._currentSegmentIndex) {
        this._currentSegmentIndex = segIdx;
        this._npcs.loadSegment(currentSeg.descriptor, this._app.screen.height * this._groundLineRatio);
        // Sync sun/moon and dust terrain
        if (currentSeg.descriptor.timeOfDay) {
          this._sunMoon.transitionTo(currentSeg.descriptor.timeOfDay);
        }
        if (currentSeg.descriptor.terrain) {
          this._dust.setTerrain(currentSeg.descriptor.terrain);
        }
      }
      this._npcs.update(1 / 60, worldPosition, currentSeg.worldX);
    }

    // ── Animate grain ─────────────────────────────────────────────────────
    this._grainOffsetX = ((this._grainOffsetX + (Math.random() - 0.5) * 3) % 256 + 256) % 256;
    this._grainOffsetY = ((this._grainOffsetY + (Math.random() - 0.5) * 3) % 256 + 256) % 256;
    const grain = this.postProcess.grainSprite as unknown as PIXI.TilingSprite;
    if (grain.tilePosition) {
      grain.tilePosition.set(this._grainOffsetX, this._grainOffsetY);
    }
  }

  setQualityMode(mode: "default" | "eco"): void {
    if (mode === "eco") {
      this._app.renderer.resolution = 1;
      this.postProcess.grainSprite.visible = false;
      this._reloadTexturesAtHalfResolution();
    } else {
      this._app.renderer.resolution = Math.min(window.devicePixelRatio ?? 1, this._nativeDPR);
      this.postProcess.grainSprite.visible = true;
      this._reloadTexturesAtFullResolution();
    }
    this._app.renderer.resize(this._app.screen.width, this._app.screen.height);
  }

  setGroundLine(ratio: number): void {
    this._groundLineRatio = ratio;
    this._positionCyclist();
  }

  handleResize(): void {
    this._app.renderer.resize(window.innerWidth, window.innerHeight);
    const grain = this.postProcess.grainSprite as unknown as PIXI.TilingSprite;
    if (grain.tilePosition) {
      grain.width  = this._app.screen.width;
      grain.height = this._app.screen.height;
    }
    this._positionCyclist();
    this._sunMoon.handleResize(this._app.screen.width, this._app.screen.height);
  }

  get appliedDPR(): number {
    return this._app.renderer.resolution;
  }

  // ── Accessors for tests ───────────────────────────────────────────────────

  get bgContainer():  PIXI.Container { return this._bgContainer; }
  get mgContainer():  PIXI.Container { return this._mgContainer; }
  get fgContainer():  PIXI.Container { return this._fgContainer; }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _getCurrentSegment(
    worldPosition: number,
    segments: SegmentInstance[],
  ): SegmentInstance | undefined {
    let current: SegmentInstance | undefined;
    for (const seg of segments) {
      if (seg.worldX <= worldPosition) current = seg;
    }
    return current;
  }

  private _positionCyclist(): void {
    const w = this._app.screen.width;
    const h = this._app.screen.height;
    const root = this._cyclistRig.parts.root;
    root.x = w * 0.20;
    root.y = h * this._groundLineRatio;
    root.scale.set(1.6);
  }

  private _generateGrainTexture(): PIXI.Texture {
    const SIZE = 256;
    try {
      const canvas = document.createElement("canvas");
      canvas.width  = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return PIXI.Texture.WHITE;
      const imageData = ctx.createImageData(SIZE, SIZE);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = Math.random() > 0.5 ? 0 : 255;
        imageData.data[i]     = v;
        imageData.data[i + 1] = v;
        imageData.data[i + 2] = v;
        imageData.data[i + 3] = Math.floor(Math.random() * 40);
      }
      ctx.putImageData(imageData, 0, 0);
      // In test environments the pixi.js mock's Texture.from may not accept
      // a canvas element — fall back to WHITE gracefully.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (PIXI.Texture.from as unknown as (src: any) => PIXI.Texture)(canvas) ?? PIXI.Texture.WHITE;
    } catch {
      return PIXI.Texture.WHITE;
    }
  }

  private _reloadTexturesAtHalfResolution(): void {
    for (const segment of this._trackedSegments) {
      const { layers } = segment.descriptor;
      segment.bgSprite.texture = PIXI.Texture.from(toHalfResUrl(layers.background));
      segment.mgSprite.texture = PIXI.Texture.from(toHalfResUrl(layers.midground));
      segment.fgSprite.texture = PIXI.Texture.from(toHalfResUrl(layers.foreground));
    }
  }

  private _reloadTexturesAtFullResolution(): void {
    for (const segment of this._trackedSegments) {
      const { layers } = segment.descriptor;
      segment.bgSprite.texture = PIXI.Texture.from(toFullResUrl(layers.background));
      segment.mgSprite.texture = PIXI.Texture.from(toFullResUrl(layers.midground));
      segment.fgSprite.texture = PIXI.Texture.from(toFullResUrl(layers.foreground));
    }
  }
}
