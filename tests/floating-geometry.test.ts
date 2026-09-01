import { beforeEach, describe, expect, it } from "vitest";
import {
  FLOATING_BALL_SIZE,
  FLOATING_BUTTON_SIZE,
  FLOATING_MARGIN,
  clampFloatingPosition,
  computeRadialPositions,
  hasExceededDragThreshold,
  restoreFloatingPosition,
  selectBestVisibleAnswer,
  snapFloatingPosition,
} from "../src/floating-geometry";

const viewport = { width: 1200, height: 800 };

function answerWithRect(rect: Partial<DOMRect>, eligible = true) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
    ...rect,
  });
  return { element, eligible };
}

describe("AssistiveTouch floating geometry", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clamps and snaps the ball to the nearest viewport edge", () => {
    expect(clampFloatingPosition({ x: -200, y: 900 }, viewport)).toEqual({
      x: FLOATING_MARGIN,
      y: viewport.height - FLOATING_BALL_SIZE - FLOATING_MARGIN,
    });

    const left = snapFloatingPosition({ x: 220, y: 300 }, viewport);
    const right = snapFloatingPosition({ x: 900, y: 300 }, viewport);
    expect(left.stored.side).toBe("left");
    expect(left.position.x).toBe(FLOATING_MARGIN);
    expect(right.stored.side).toBe("right");
    expect(right.position.x).toBe(viewport.width - FLOATING_BALL_SIZE - FLOATING_MARGIN);
  });

  it("distinguishes a tap from a drag at six pixels", () => {
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 14, y: 13 })).toBe(false);
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(true);
  });

  it("restores the saved edge and proportional vertical position", () => {
    const position = restoreFloatingPosition({ side: "left", yRatio: 0.5 }, viewport);
    expect(position.x).toBe(FLOATING_MARGIN);
    expect(position.y).toBeCloseTo((viewport.height - FLOATING_BALL_SIZE) / 2);
  });

  it("keeps radial menu buttons inside the viewport near every edge", () => {
    for (const [position, side] of [
      [{ x: FLOATING_MARGIN, y: FLOATING_MARGIN }, "left"],
      [{ x: viewport.width - FLOATING_BALL_SIZE - FLOATING_MARGIN, y: viewport.height - FLOATING_BALL_SIZE - FLOATING_MARGIN }, "right"],
    ] as const) {
      const buttons = computeRadialPositions(position, side, 6, viewport, 154);
      expect(buttons).toHaveLength(6);
      buttons.forEach((button) => {
        expect(button.left).toBeGreaterThanOrEqual(FLOATING_MARGIN);
        expect(button.top).toBeGreaterThanOrEqual(FLOATING_MARGIN);
        expect(button.left + FLOATING_BUTTON_SIZE).toBeLessThanOrEqual(viewport.width - FLOATING_MARGIN);
        expect(button.top + FLOATING_BUTTON_SIZE).toBeLessThanOrEqual(viewport.height - FLOATING_MARGIN);
      });
    }
  });

  it("selects the eligible answer with the largest visible area", () => {
    const small = answerWithRect({ left: 200, right: 900, top: 20, bottom: 180, width: 700, height: 160 });
    const large = answerWithRect({ left: 200, right: 900, top: 230, bottom: 700, width: 700, height: 470 });
    const streaming = answerWithRect({ left: 0, right: 1200, top: 0, bottom: 800, width: 1200, height: 800 }, false);
    expect(selectBestVisibleAnswer([small, large, streaming], viewport)).toBe(large);
  });

  it("uses center distance as a tie breaker and ignores disconnected answers", () => {
    const far = answerWithRect({ left: 0, right: 200, top: 0, bottom: 200, width: 200, height: 200 });
    const near = answerWithRect({ left: 500, right: 700, top: 300, bottom: 500, width: 200, height: 200 });
    const disconnected = answerWithRect({ left: 400, right: 800, top: 200, bottom: 600, width: 400, height: 400 });
    disconnected.element.remove();
    expect(selectBestVisibleAnswer([far, near, disconnected], viewport)).toBe(near);
  });
});
