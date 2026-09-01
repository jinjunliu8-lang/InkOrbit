import { describe, expect, it } from "vitest";
import { drawingGestureConstants, drawingSurfaceTestHelpers } from "../src/drawing-surface";

describe("drawing and panning gesture boundary", () => {
  it("keeps movement within five pixels pending for long-press panning", () => {
    expect(drawingGestureConstants.LONG_PRESS_MS).toBe(180);
    expect(drawingGestureConstants.MOVE_TOLERANCE).toBe(5);
    expect(drawingSurfaceTestHelpers.shouldStartDrawing(0, 0, 3, 4)).toBe(false);
    expect(drawingSurfaceTestHelpers.classifyPendingGesture(179, 5)).toBe("pending");
    expect(drawingSurfaceTestHelpers.classifyPendingGesture(180, 5)).toBe("panning");
  });

  it("starts drawing as soon as movement exceeds five pixels", () => {
    expect(drawingSurfaceTestHelpers.shouldStartDrawing(0, 0, 5.01, 0)).toBe(true);
    expect(drawingSurfaceTestHelpers.classifyPendingGesture(20, 5.01)).toBe("drawing");
    expect(drawingSurfaceTestHelpers.movement(0, 0, 6, 8)).toBe(10);
  });
});
