import { describe, expect, it, vi } from "vitest";
import { renderPageStrokes } from "../src/renderer";
import type { Stroke } from "../src/types";

function fakeContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "butt",
    lineJoin: "miter",
    lineWidth: 1,
  };
}

describe("page-space renderer", () => {
  it("maps document coordinates into the current viewport", () => {
    const context = fakeContext();
    const stroke: Stroke = {
      id: "stroke-1",
      tool: "pen",
      color: "#000",
      baseWidth: 4,
      opacity: 1,
      points: [
        { x: 125, y: 250, pressure: 0.5, time: 0 },
        { x: 145, y: 280, pressure: 0.5, time: 1 },
      ],
    };

    renderPageStrokes(
      context as unknown as CanvasRenderingContext2D,
      [stroke],
      { width: 800, height: 600 },
      { x: 100, y: 200 },
      2,
    );

    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(context.moveTo).toHaveBeenCalledWith(25, 50);
    expect(context.lineTo).toHaveBeenCalledWith(45, 80);
  });
});
