import { describe, expect, it } from "vitest";
import { drawingSurfaceTestHelpers } from "../src/drawing-surface";

describe("drawing and panning gesture boundary", () => {
  it("measures wheel gesture pointer movement", () => {
    expect(drawingSurfaceTestHelpers.movement(0, 0, 6, 8)).toBe(10);
  });

  it("normalizes wheel and trackpad deltas before forwarding them", () => {
    expect(drawingSurfaceTestHelpers.normalizeWheelDelta(12, WheelEvent.DOM_DELTA_PIXEL, 900)).toBe(12);
    expect(drawingSurfaceTestHelpers.normalizeWheelDelta(3, WheelEvent.DOM_DELTA_LINE, 900)).toBe(48);
    expect(drawingSurfaceTestHelpers.normalizeWheelDelta(1, WheelEvent.DOM_DELTA_PAGE, 900)).toBe(900);
  });
});
