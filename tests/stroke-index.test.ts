import { describe, expect, it } from "vitest";
import { StrokeGridIndex } from "../src/stroke-index";
import type { Stroke } from "../src/types";

function stroke(id: string, x: number, y: number, endX = x + 10): Stroke {
  return {
    id,
    tool: "pen",
    color: "#000",
    baseWidth: 4,
    opacity: 1,
    points: [
      { x, y, pressure: 0.5, time: 0 },
      { x: endX, y: y + 10, pressure: 0.5, time: 1 },
    ],
  };
}

describe("stroke spatial index", () => {
  it("returns only strokes near the visible viewport", () => {
    const index = new StrokeGridIndex();
    index.rebuild([
      stroke("visible", 100, 100),
      stroke("below", 100, 2200),
      stroke("right", 2400, 100),
    ]);

    expect(index.query({ left: 0, top: 0, right: 800, bottom: 600 }).map((item) => item.id))
      .toEqual(["visible"]);
  });

  it("deduplicates a long stroke spanning several grid cells", () => {
    const index = new StrokeGridIndex();
    index.rebuild([stroke("long", 10, 10, 1000)]);
    expect(index.query({ left: 0, top: 0, right: 1200, bottom: 300 })).toHaveLength(1);
  });
});
