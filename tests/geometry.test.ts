import { describe, expect, it } from "vitest";
import { distanceToSegment, eraseStrokesAt } from "../src/geometry";
import type { Stroke, StrokePoint } from "../src/types";

const point = (x: number, y: number): StrokePoint => ({ x, y, pressure: 0.5, time: 0 });

describe("drawing geometry", () => {
  it("measures distance to the nearest point on a segment", () => {
    expect(distanceToSegment(point(5, 4), point(0, 0), point(10, 0))).toBe(4);
    expect(distanceToSegment(point(-3, 4), point(0, 0), point(10, 0))).toBe(5);
  });

  it("erases intersecting strokes without touching distant strokes", () => {
    const near: Stroke = {
      id: "near",
      tool: "pen",
      color: "#000",
      baseWidth: 2,
      opacity: 1,
      points: [point(0, 0), point(10, 0)],
    };
    const far: Stroke = { ...near, id: "far", points: [point(0, 20), point(10, 20)] };

    expect(eraseStrokesAt([near, far], point(5, 2), 2).map((stroke) => stroke.id)).toEqual(["far"]);
  });
});
