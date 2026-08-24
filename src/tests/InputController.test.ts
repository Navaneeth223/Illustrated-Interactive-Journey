// @vitest-environment jsdom

/**
 * Unit tests for InputController.
 *
 * Verifies that each input device emits exactly one `holdStart` per press and
 * one `holdEnd` per release, and that `keydown` repeat events are suppressed.
 *
 * Validates: Requirements 4.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InputController } from "@/modules/InputController";

describe("InputController", () => {
  let canvas: HTMLCanvasElement;
  let controller: InputController;
  let holdStarts: number;
  let holdEnds: number;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    controller = new InputController(canvas);
    holdStarts = 0;
    holdEnds = 0;
    controller.on("holdStart", () => holdStarts++);
    controller.on("holdEnd", () => holdEnds++);
  });

  afterEach(() => {
    controller.destroy();
  });

  // ---------------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------------

  it("mousedown emits exactly one holdStart", () => {
    canvas.dispatchEvent(new MouseEvent("mousedown"));
    expect(holdStarts).toBe(1);
    expect(holdEnds).toBe(0);
  });

  it("mouseup emits exactly one holdEnd", () => {
    canvas.dispatchEvent(new MouseEvent("mouseup"));
    expect(holdEnds).toBe(1);
    expect(holdStarts).toBe(0);
  });

  it("multiple mousedown/mouseup pairs each emit one event", () => {
    for (let i = 0; i < 3; i++) {
      canvas.dispatchEvent(new MouseEvent("mousedown"));
      canvas.dispatchEvent(new MouseEvent("mouseup"));
    }
    expect(holdStarts).toBe(3);
    expect(holdEnds).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Touch
  // ---------------------------------------------------------------------------

  it("touchstart emits exactly one holdStart", () => {
    canvas.dispatchEvent(new TouchEvent("touchstart", { cancelable: true }));
    expect(holdStarts).toBe(1);
    expect(holdEnds).toBe(0);
  });

  it("touchend emits exactly one holdEnd", () => {
    canvas.dispatchEvent(new TouchEvent("touchend", { cancelable: true }));
    expect(holdEnds).toBe(1);
    expect(holdStarts).toBe(0);
  });

  it("touchstart calls preventDefault", () => {
    const event = new TouchEvent("touchstart", { cancelable: true });
    const spy = vi.spyOn(event, "preventDefault");
    canvas.dispatchEvent(event);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("touchend calls preventDefault", () => {
    const event = new TouchEvent("touchend", { cancelable: true });
    const spy = vi.spyOn(event, "preventDefault");
    canvas.dispatchEvent(event);
    expect(spy).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Keyboard — Space
  // ---------------------------------------------------------------------------

  it("keydown Space (not repeat) emits exactly one holdStart", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat: false }));
    expect(holdStarts).toBe(1);
    expect(holdEnds).toBe(0);
  });

  it("keydown Space with repeat:true does NOT emit holdStart", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat: true }));
    expect(holdStarts).toBe(0);
  });

  it("keyup Space emits exactly one holdEnd", () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    expect(holdEnds).toBe(1);
    expect(holdStarts).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Keyboard — ArrowRight
  // ---------------------------------------------------------------------------

  it("keydown ArrowRight (not repeat) emits exactly one holdStart", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", repeat: false }));
    expect(holdStarts).toBe(1);
    expect(holdEnds).toBe(0);
  });

  it("keydown ArrowRight with repeat:true does NOT emit holdStart", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", repeat: true }));
    expect(holdStarts).toBe(0);
  });

  it("keyup ArrowRight emits exactly one holdEnd", () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    expect(holdEnds).toBe(1);
    expect(holdStarts).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Keyboard — unrelated keys are ignored
  // ---------------------------------------------------------------------------

  it("keydown with an unrelated key does NOT emit holdStart", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", repeat: false }));
    expect(holdStarts).toBe(0);
  });

  it("keyup with an unrelated key does NOT emit holdEnd", () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
    expect(holdEnds).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // destroy() — all listeners removed
  // ---------------------------------------------------------------------------

  it("destroy() prevents further holdStart events from mouse", () => {
    controller.destroy();
    canvas.dispatchEvent(new MouseEvent("mousedown"));
    expect(holdStarts).toBe(0);
  });

  it("destroy() prevents further holdEnd events from mouse", () => {
    controller.destroy();
    canvas.dispatchEvent(new MouseEvent("mouseup"));
    expect(holdEnds).toBe(0);
  });

  it("destroy() prevents further holdStart events from keyboard", () => {
    controller.destroy();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat: false }));
    expect(holdStarts).toBe(0);
  });

  it("destroy() prevents further holdEnd events from keyboard", () => {
    controller.destroy();
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    expect(holdEnds).toBe(0);
  });

  it("destroy() prevents further holdStart events from touch", () => {
    controller.destroy();
    canvas.dispatchEvent(new TouchEvent("touchstart", { cancelable: true }));
    expect(holdStarts).toBe(0);
  });

  it("destroy() prevents further holdEnd events from touch", () => {
    controller.destroy();
    canvas.dispatchEvent(new TouchEvent("touchend", { cancelable: true }));
    expect(holdEnds).toBe(0);
  });
});
