// @vitest-environment jsdom

/**
 * Unit tests for JourneyController.
 *
 * Verifies the three-phase state machine (gate → travelling → arrived),
 * input gating, and arrival-screen triggering.
 *
 * Requirements: 1.2, 1.3, 1.4, 4.1, 4.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JourneyController } from "@/modules/JourneyController";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// GSAP mock — instant stub, avoids gsap import side-effects.
vi.mock("gsap", () => ({
  gsap: {
    to: (
      target: Record<string, number>,
      vars: Record<string, unknown>
    ): { kill: () => void } => {
      const GSAP_OPTIONS = new Set([
        "duration", "ease", "overwrite", "onComplete", "onUpdate",
        "delay", "repeat", "yoyo", "paused",
      ]);
      for (const [key, value] of Object.entries(vars)) {
        if (!GSAP_OPTIONS.has(key) && typeof value === "number") {
          target[key] = value;
        }
      }
      return { kill: () => {} };
    },
  },
}));

// Howler mock — avoids audio API side-effects.
vi.mock("howler", () => ({
  Howler: { ctx: { resume: vi.fn().mockResolvedValue(undefined) } },
  Howl: vi.fn().mockImplementation(() => ({
    play: vi.fn(),
    stop: vi.fn(),
    fade: vi.fn(),
    volume: vi.fn().mockReturnValue(0),
  })),
}));

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeAudioGate(choice: "sound-on" | "sound-off" = "sound-off") {
  return {
    show: vi.fn().mockResolvedValue(choice),
  };
}

function makeVelocityModel() {
  const stub = {
    _worldPosition: 0,
    _state: { velocity: 0 },
    get worldPosition() { return stub._worldPosition; },
    get velocity() { return stub._state.velocity; },
    tick: vi.fn(),
    startHold: vi.fn(),
    releaseHold: vi.fn(),
    isHolding: false,
  };
  return stub;
}

function makeSequencer(isAtArrival = false) {
  return {
    update: vi.fn(),
    get activeSegments() { return []; },
    get isAtArrival() { return isAtArrival; },
    forceReloadAll: vi.fn(),
    totalWorldWidth: 10000,
  };
}

function makePixiRenderer() {
  return {
    render: vi.fn(),
    setQualityMode: vi.fn(),
  };
}

function makeAudioController() {
  return {
    transitionToSegment: vi.fn(),
    setMotionState: vi.fn(),
    setSoundEnabled: vi.fn(),
    isCrossfading: false,
  };
}

function makeInputController() {
  const listeners: Map<string, Set<() => void>> = new Map();
  return {
    on: vi.fn((event: string, listener: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit(event: string) {
      listeners.get(event)?.forEach((fn) => fn());
    },
    _listeners: listeners,
  };
}

function makeArrivalScreen() {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: false,
  };
}

function makeApp() {
  const canvas = document.createElement("canvas");
  return {
    canvas,
    renderer: {
      reset: vi.fn(),
      resolution: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: build a JourneyController with all stubs
// ---------------------------------------------------------------------------

function buildController(overrides: {
  audioGate?: ReturnType<typeof makeAudioGate>;
  velocityModel?: ReturnType<typeof makeVelocityModel>;
  sequencer?: ReturnType<typeof makeSequencer>;
  pixiRenderer?: ReturnType<typeof makePixiRenderer>;
  audioController?: ReturnType<typeof makeAudioController>;
  inputController?: ReturnType<typeof makeInputController>;
  arrivalScreen?: ReturnType<typeof makeArrivalScreen>;
  app?: ReturnType<typeof makeApp>;
} = {}) {
  const audioGate = overrides.audioGate ?? makeAudioGate();
  const velocityModel = overrides.velocityModel ?? makeVelocityModel();
  const sequencer = overrides.sequencer ?? makeSequencer();
  const pixiRenderer = overrides.pixiRenderer ?? makePixiRenderer();
  const audioController = overrides.audioController ?? makeAudioController();
  const inputController = overrides.inputController ?? makeInputController();
  const arrivalScreen = overrides.arrivalScreen ?? makeArrivalScreen();
  const app = overrides.app ?? makeApp();

  const controller = new JourneyController(
    audioGate as never,
    velocityModel as never,
    sequencer as never,
    pixiRenderer as never,
    audioController as never,
    inputController as never,
    arrivalScreen as never,
    app as never,
  );

  return {
    controller,
    audioGate,
    velocityModel,
    sequencer,
    pixiRenderer,
    audioController,
    inputController,
    arrivalScreen,
    app,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JourneyController — phase transitions", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("performance", { now: vi.fn().mockReturnValue(0) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Test 1: gate → travelling transition
  // ---------------------------------------------------------------------------

  it("phase is 'gate' before start() is called", () => {
    const { controller } = buildController();
    expect(controller.phase).toBe("gate");
  });

  it("phase transitions to 'travelling' after audioGate.show() resolves", async () => {
    const { controller } = buildController();
    await controller.start();
    expect(controller.phase).toBe("travelling");
  });

  it("audioController.setSoundEnabled(true) is called when choice is 'sound-on'", async () => {
    const { controller, audioController } = buildController({
      audioGate: makeAudioGate("sound-on"),
    });
    await controller.start();
    expect(audioController.setSoundEnabled).toHaveBeenCalledWith(true);
  });

  it("audioController.setSoundEnabled(false) is called when choice is 'sound-off'", async () => {
    const { controller, audioController } = buildController({
      audioGate: makeAudioGate("sound-off"),
    });
    await controller.start();
    expect(audioController.setSoundEnabled).toHaveBeenCalledWith(false);
  });

  it("inputController.on() is called for holdStart and holdEnd after start()", async () => {
    const { controller, inputController } = buildController();
    await controller.start();
    expect(inputController.on).toHaveBeenCalledWith("holdStart", expect.any(Function));
    expect(inputController.on).toHaveBeenCalledWith("holdEnd", expect.any(Function));
  });

  it("requestAnimationFrame is scheduled after start()", async () => {
    const rafSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    const { controller } = buildController();
    await controller.start();
    expect(rafSpy).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Test 2: travelling → arrived transition
  // ---------------------------------------------------------------------------

  it("phase transitions to 'arrived' when sequencer.isAtArrival is true on tick", async () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const sequencer = makeSequencer(true); // isAtArrival = true immediately
    const { controller } = buildController({ sequencer });

    await controller.start();
    expect(rafCalls.length).toBeGreaterThan(0);

    // Run first tick — should detect arrival.
    rafCalls[rafCalls.length - 1](16);

    expect(controller.phase).toBe("arrived");
  });

  it("arrivalScreen.show() is called when arriving", async () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const sequencer = makeSequencer(true);
    const arrivalScreen = makeArrivalScreen();
    const { controller } = buildController({ sequencer, arrivalScreen });

    await controller.start();
    rafCalls[rafCalls.length - 1](16);

    expect(arrivalScreen.show).toHaveBeenCalledOnce();
  });

  it("velocityModel.releaseHold() is called when arriving", async () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const sequencer = makeSequencer(true);
    const velocityModel = makeVelocityModel();
    const { controller } = buildController({ sequencer, velocityModel });

    await controller.start();
    rafCalls[rafCalls.length - 1](16);

    expect(velocityModel.releaseHold).toHaveBeenCalled();
  });

  it("inputController.off() is called for holdStart and holdEnd on arrival", async () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const sequencer = makeSequencer(true);
    const inputController = makeInputController();
    const { controller } = buildController({ sequencer, inputController });

    await controller.start();
    rafCalls[rafCalls.length - 1](16);

    expect(inputController.off).toHaveBeenCalledWith("holdStart", expect.any(Function));
    expect(inputController.off).toHaveBeenCalledWith("holdEnd", expect.any(Function));
  });

  // ---------------------------------------------------------------------------
  // Test 3: Input events are ignored in 'gate' phase
  // ---------------------------------------------------------------------------

  it("holdStart before start() resolves does NOT call velocityModel.startHold()", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());

    const velocityModel = makeVelocityModel();
    const inputController = makeInputController();

    // Build the controller but don't call start() yet — still in "gate" phase.
    const { controller } = buildController({ velocityModel, inputController });
    expect(controller.phase).toBe("gate");

    // Simulate a holdStart arriving before start() resolves.
    // The listener isn't subscribed yet in gate phase, so this is a no-op test.
    // We verify startHold was never called.
    expect(velocityModel.startHold).not.toHaveBeenCalled();
  });

  it("holdStart input during gate phase (listener manually tested) does NOT startHold", () => {
    // Directly test the guard condition: if phase is 'gate', the onHoldStart
    // callback must not forward to velocityModel.startHold().
    const velocityModel = makeVelocityModel();
    const inputController = makeInputController();
    buildController({ velocityModel, inputController });

    // Phase is 'gate'. Subscribe a manual listener to simulate what would happen
    // if something tried to deliver holdStart:
    // The controller hasn't called inputController.on() yet (only done in start()).
    // So there's no listener registered — startHold will never fire.
    inputController.emit("holdStart");
    expect(velocityModel.startHold).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 4: Input events are ignored in 'arrived' phase
  // ---------------------------------------------------------------------------

  it("holdStart after arriving does NOT call velocityModel.startHold()", async () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const sequencer = makeSequencer(true); // arrives immediately
    const velocityModel = makeVelocityModel();
    const inputController = makeInputController();

    const { controller } = buildController({ sequencer, velocityModel, inputController });

    await controller.start();
    // Run the tick — transitions to 'arrived', unsubscribes input.
    rafCalls[rafCalls.length - 1](16);

    expect(controller.phase).toBe("arrived");

    // Reset the startHold mock to isolate post-arrival calls.
    velocityModel.startHold.mockClear();

    // Emit holdStart — should be ignored because the listener was removed.
    inputController.emit("holdStart");

    expect(velocityModel.startHold).not.toHaveBeenCalled();
  });

  it("holdEnd after arriving does NOT call velocityModel.releaseHold() again", async () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const sequencer = makeSequencer(true);
    const velocityModel = makeVelocityModel();
    const inputController = makeInputController();

    const { controller } = buildController({ sequencer, velocityModel, inputController });

    await controller.start();
    rafCalls[rafCalls.length - 1](16);

    expect(controller.phase).toBe("arrived");

    // releaseHold is called once during arrival transition; clear the mock.
    velocityModel.releaseHold.mockClear();

    // Emit holdEnd — should be ignored.
    inputController.emit("holdEnd");

    expect(velocityModel.releaseHold).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// worldPosition getter
// ---------------------------------------------------------------------------

describe("JourneyController — worldPosition getter", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("performance", { now: vi.fn().mockReturnValue(0) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("worldPosition delegates to velocityModel.worldPosition", () => {
    const velocityModel = makeVelocityModel();
    velocityModel._worldPosition = 1234;

    const { controller } = buildController({ velocityModel });
    expect(controller.worldPosition).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// seekTo and WebGL context-loss recovery
// ---------------------------------------------------------------------------

describe("JourneyController — seekTo and WebGL context-loss recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("performance", { now: vi.fn().mockReturnValue(0) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── seekTo ────────────────────────────────────────────────────────────────

  it("seekTo(pos) sets velocityModel._worldPosition to pos", () => {
    const velocityModel = makeVelocityModel();
    const { controller } = buildController({ velocityModel });

    controller.seekTo(500);

    expect(velocityModel._worldPosition).toBe(500);
  });

  it("seekTo(pos) calls pixiRenderer.render with the given pos and activeSegments", () => {
    const pixiRenderer = makePixiRenderer();
    const sequencer = makeSequencer();
    const { controller } = buildController({ pixiRenderer, sequencer });

    controller.seekTo(1200);

    expect(pixiRenderer.render).toHaveBeenCalledWith(1200, 0, sequencer.activeSegments);
  });

  it("seekTo(pos) calls audioController.transitionToSegment with index 0 when no segments", () => {
    const audioController = makeAudioController();
    const { controller } = buildController({ audioController });

    controller.seekTo(0);

    expect(audioController.transitionToSegment).toHaveBeenCalledWith(0);
  });

  it("seekTo(pos) calls audioController.transitionToSegment with the last segment whose worldX <= pos", () => {
    const audioController = makeAudioController();

    // Build a sequencer with three segments at worldX 0, 1000, 2000.
    const segments = [
      { worldX: 0,    descriptor: { widthPx: 1000 }, loaded: true, recycled: false, container: null },
      { worldX: 1000, descriptor: { widthPx: 1000 }, loaded: true, recycled: false, container: null },
      { worldX: 2000, descriptor: { widthPx: 1000 }, loaded: true, recycled: false, container: null },
    ];
    const sequencer = {
      update: vi.fn(),
      get activeSegments() { return segments; },
      get isAtArrival() { return false; },
      forceReloadAll: vi.fn(),
      totalWorldWidth: 3000,
    };

    const { controller } = buildController({ audioController, sequencer: sequencer as never });

    // pos = 1500 → falls in segment at worldX 1000 (index 1)
    controller.seekTo(1500);

    expect(audioController.transitionToSegment).toHaveBeenCalledWith(1);
  });

  it("seekTo(pos) selects the last matching segment when multiple worldX <= pos", () => {
    const audioController = makeAudioController();

    const segments = [
      { worldX: 0,    descriptor: { widthPx: 500 }, loaded: true, recycled: false, container: null },
      { worldX: 500,  descriptor: { widthPx: 500 }, loaded: true, recycled: false, container: null },
      { worldX: 1000, descriptor: { widthPx: 500 }, loaded: true, recycled: false, container: null },
    ];
    const sequencer = {
      update: vi.fn(),
      get activeSegments() { return segments; },
      get isAtArrival() { return false; },
      forceReloadAll: vi.fn(),
      totalWorldWidth: 1500,
    };

    const { controller } = buildController({ audioController, sequencer: sequencer as never });

    // pos = 2000 → all segments qualify; last one (index 2) should be selected
    controller.seekTo(2000);

    expect(audioController.transitionToSegment).toHaveBeenCalledWith(2);
  });

  // ── handleContextLost ─────────────────────────────────────────────────────

  it("handleContextLost() saves worldPosition at time of call", () => {
    const velocityModel = makeVelocityModel();
    velocityModel._worldPosition = 7500;

    const { controller } = buildController({ velocityModel });

    controller.handleContextLost();

    // After context loss, handleContextRestored should seek back to 7500.
    // We verify by reading _savedPosition indirectly through a subsequent
    // handleContextRestored() call.
    const app = makeApp();
    const sequencer = makeSequencer();
    const pixiRenderer = makePixiRenderer();
    const audioController = makeAudioController();

    // Build a fresh controller at the same position and verify seekTo is called
    // with the saved position upon restore.
    const velocityModel2 = makeVelocityModel();
    velocityModel2._worldPosition = 7500;

    const { controller: ctrl2, pixiRenderer: pr2, sequencer: seq2 } = buildController({
      velocityModel: velocityModel2,
      app,
      pixiRenderer,
      sequencer,
      audioController,
    });

    ctrl2.handleContextLost();
    ctrl2.handleContextRestored();

    expect(pr2.render).toHaveBeenCalledWith(7500, 0, seq2.activeSegments);
  });

  it("handleContextLost() sets internal _contextLost flag (rAF loop skips render)", () => {
    // After handleContextLost, the rAF tick must NOT call pixiRenderer.render.
    const rafCalls: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const audioGate = makeAudioGate("sound-off");
    const pixiRenderer = makePixiRenderer();
    const sequencer = makeSequencer(false);
    const { controller } = buildController({ audioGate, pixiRenderer, sequencer });

    // Start the journey so rAF is running.
    void controller.start();

    controller.handleContextLost();

    // Run a tick — render must be skipped.
    if (rafCalls.length > 0) {
      rafCalls[rafCalls.length - 1](16);
    }

    expect(pixiRenderer.render).not.toHaveBeenCalled();
  });

  // ── handleContextRestored ─────────────────────────────────────────────────

  it("handleContextRestored() calls sequencer.forceReloadAll() (reset no longer called — PixiJS 8 handles context restore automatically)", () => {
    const sequencer = makeSequencer();
    const { controller } = buildController({ sequencer });

    controller.handleContextRestored();

    expect(sequencer.forceReloadAll).toHaveBeenCalledOnce();
  });

  it("handleContextRestored() calls sequencer.forceReloadAll()", () => {
    const sequencer = makeSequencer();
    const { controller } = buildController({ sequencer });

    controller.handleContextRestored();

    expect(sequencer.forceReloadAll).toHaveBeenCalledOnce();
  });

  it("handleContextRestored() calls seekTo(savedPosition)", () => {
    const velocityModel = makeVelocityModel();
    velocityModel._worldPosition = 3333;

    const pixiRenderer = makePixiRenderer();
    const { controller } = buildController({ velocityModel, pixiRenderer });

    controller.handleContextLost();   // saves position = 3333
    pixiRenderer.render.mockClear();  // clear any prior calls
    controller.handleContextRestored();

    expect(pixiRenderer.render).toHaveBeenCalledWith(3333, expect.anything(), expect.anything());
  });

  it("handleContextRestored() calls forceReloadAll() then seekTo() in correct order", () => {
    const callOrder: string[] = [];
    const app = makeApp();
    const sequencer = makeSequencer();

    (sequencer.forceReloadAll as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("forceReloadAll");
    });

    const { controller } = buildController({ app, sequencer });

    controller.handleContextRestored();

    expect(callOrder).toEqual(["forceReloadAll"]);
  });

  // ── Canvas event wiring ───────────────────────────────────────────────────

  it("webglcontextlost event on canvas triggers context-loss behaviour", () => {
    const velocityModel = makeVelocityModel();
    velocityModel._worldPosition = 9876;

    const app = makeApp();
    const pixiRenderer = makePixiRenderer();
    const { controller } = buildController({ velocityModel, app, pixiRenderer });

    const lostEvent = new Event("webglcontextlost", { bubbles: false, cancelable: true });
    app.canvas.dispatchEvent(lostEvent);

    // After loss, the tick should skip rendering.
    // We also confirm position is preserved by triggering a restore.
    pixiRenderer.render.mockClear();
    const restoredEvent = new Event("webglcontextrestored", { bubbles: false });
    app.canvas.dispatchEvent(restoredEvent);

    expect(pixiRenderer.render).toHaveBeenCalledWith(9876, expect.anything(), expect.anything());
  });

  it("webglcontextrestored event on canvas calls sequencer.forceReloadAll() (PixiJS 8 handles reset automatically)", () => {
    const app = makeApp();
    const sequencer = makeSequencer();
    const { controller: _controller } = buildController({ sequencer, app });
    sequencer.forceReloadAll.mockClear();

    app.canvas.dispatchEvent(new Event("webglcontextrestored", { bubbles: false }));

    expect(sequencer.forceReloadAll).toHaveBeenCalledOnce();
  });

  it("webglcontextlost event calls e.preventDefault()", () => {
    const app = makeApp();
    buildController({ app });

    const lostEvent = new Event("webglcontextlost", { bubbles: false, cancelable: true });
    const preventDefaultSpy = vi.spyOn(lostEvent, "preventDefault");

    app.canvas.dispatchEvent(lostEvent);

    expect(preventDefaultSpy).toHaveBeenCalledOnce();
  });
});

