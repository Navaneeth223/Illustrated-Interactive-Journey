/**
 * Illustrated Interactive Journey — application entry point.
 *
 * Bootstrap sequence:
 *  1. Register WebP → PNG fallback parser for non-WebP browsers.
 *  2. Load the journey manifest (with retry + error overlay on failure).
 *  3. Initialise the PixiJS Application (creates canvas, appends to DOM).
 *  4. Instantiate all subsystem modules.
 *  5. Instantiate JourneyController and call start().
 */

import * as PIXI from "pixi.js";

import { App } from "@/App";
import { loadManifest } from "@/manifest";
import { registerWebpFallback } from "@/modules/WebpFallback";
import { VelocityModel } from "@/modules/VelocityModel";
import { MyrioramaSequencer } from "@/modules/MyrioramaSequencer";
import { PixiRenderer } from "@/modules/PixiRenderer";
import { AudioController } from "@/modules/AudioController";
import { AudioGate } from "@/modules/AudioGate";
import { InputController } from "@/modules/InputController";
import { ArrivalScreen } from "@/modules/ArrivalScreen";
import { QualityHUD } from "@/modules/QualityHUD";
import { JourneyController } from "@/modules/JourneyController";

import type { SegmentDescriptor, SegmentInstance, JourneyState } from "@/types/journey";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  // 1. Register the WebP fallback so Assets.load() transparently falls back to
  //    .png on browsers that do not support WebP (Requirement 9.1).
  registerWebpFallback();

  // 2. Load the journey manifest. On network failure the function retries once
  //    and, on second failure, renders a blocking error overlay before throwing.
  const manifest = await loadManifest("/journey.manifest.json");

  // 3. Create and initialise the PixiJS Application.
  //    Context-loss callbacks are deferred — they delegate to journeyController
  //    once it is available (wired below after construction).
  let journeyController: JourneyController | null = null;

  const appInstance = new App({
    container: document.getElementById("app") ?? document.body,
    onContextLost: () => {
      journeyController?.handleContextLost();
    },
    onContextRestored: () => {
      journeyController?.handleContextRestored();
    },
    onResize: () => {
      pixiRenderer.handleResize();
      sequencer.updateViewportWidth(window.innerWidth);
    },
  });

  await appInstance.init();

  // 4. Instantiate subsystem modules.

  // ── MyrioramaSequencer ──────────────────────────────────────────────────
  //
  // The instance factory creates blank SegmentInstance shells with live PIXI
  // containers and placeholder sprites. The loadSegment callback uses
  // PIXI.Assets.load() to load the three layer textures and assign them.
  const sequencer = new MyrioramaSequencer({
    descriptors: manifest.segments,
    viewportWidth: window.innerWidth,

    instanceFactory: (descriptor: SegmentDescriptor): SegmentInstance => {
      const container = new PIXI.Container();

      // Create placeholder sprites; textures are assigned in loadSegment().
      const bgSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
      const mgSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
      const fgSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);

      // Position sprites at the segment's canonical world x offset.
      // worldX is assigned by the sequencer after the factory returns.
      container.addChild(bgSprite, mgSprite, fgSprite);

      return {
        descriptor,
        container,
        bgSprite,
        mgSprite,
        fgSprite,
        worldX: 0, // overwritten by MyrioramaSequencer constructor
        loaded: false,
        recycled: false,
      };
    },

    loadSegment: async (instance: SegmentInstance): Promise<void> => {
      const { layers } = instance.descriptor;

      // Load all three layer textures in parallel.
      const [bgTex, mgTex, fgTex] = await Promise.all([
        PIXI.Assets.load<PIXI.Texture>(layers.background),
        PIXI.Assets.load<PIXI.Texture>(layers.midground),
        PIXI.Assets.load<PIXI.Texture>(layers.foreground),
      ]);

      // Assign textures and position sprites at the segment's world x.
      instance.bgSprite.texture = bgTex;
      instance.mgSprite.texture = mgTex;
      instance.fgSprite.texture = fgTex;

      // Place each sprite at the segment's left world-space edge.
      instance.bgSprite.x = instance.worldX;
      instance.mgSprite.x = instance.worldX;
      instance.fgSprite.x = instance.worldX;
    },
  });

  // ── VelocityModel ───────────────────────────────────────────────────────
  //
  // terminalEdge is the total world width — the x coordinate at which the
  // rider is considered to have arrived (Requirement 1.3).
  const velocityModel = new VelocityModel({
    maxVelocity: manifest.maxVelocity,
    accelerationDuration: manifest.accelerationDuration,
    decelerationDuration: manifest.decelerationDuration,
    terminalEdge: sequencer.totalWorldWidth,
  });

  // ── PixiRenderer ────────────────────────────────────────────────────────
  const pixiRenderer = new PixiRenderer(appInstance.app);

  // ── AudioController ─────────────────────────────────────────────────────
  const audioController = new AudioController(manifest);

  // ── AudioGate ───────────────────────────────────────────────────────────
  const audioGate = new AudioGate();

  // ── InputController ─────────────────────────────────────────────────────
  const inputController = new InputController(
    appInstance.app.canvas as HTMLCanvasElement
  );

  // ── ArrivalScreen ───────────────────────────────────────────────────────
  const arrivalScreen = new ArrivalScreen(
    document.getElementById("app") ?? document.body
  );

  // ── JourneyState ────────────────────────────────────────────────────────
  const journeyState: JourneyState = {
    worldPosition: 0,
    currentSegmentIndex: 0,
    phase: "gate",
    qualityMode: "default",
    soundEnabled: true,
  };

  // ── QualityHUD ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  new QualityHUD(
    document.getElementById("app") ?? document.body,
    pixiRenderer,
    journeyState
  );

  // 5. Wire JourneyController and start the journey.
  journeyController = new JourneyController(
    audioGate,
    velocityModel,
    sequencer,
    pixiRenderer,
    audioController,
    inputController,
    arrivalScreen,
    appInstance.app,
    () => appInstance.showCanvas(),
  );

  await journeyController.start();
}

// Run bootstrap and surface any unhandled errors to the console.
bootstrap().catch((err: unknown) => {
  console.error("[IJJ] Bootstrap failed:", err);
});
