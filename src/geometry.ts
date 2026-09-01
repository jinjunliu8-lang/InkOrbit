import type { Stroke, StrokePoint } from "./types";

export function distanceToSegment(
  point: StrokePoint,
  start: StrokePoint,
  end: StrokePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  const nearestX = start.x + ratio * dx;
  const nearestY = start.y + ratio * dy;
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

export function strokeTouchesPoint(
  stroke: Stroke,
  point: StrokePoint,
  radius: number,
): boolean {
  if (stroke.points.length === 0) return false;
  const strokeRadius = stroke.baseWidth / 2;
  if (stroke.points.length === 1) {
    return distanceToSegment(point, stroke.points[0], stroke.points[0]) <= radius + strokeRadius;
  }

  for (let index = 1; index < stroke.points.length; index += 1) {
    if (
      distanceToSegment(point, stroke.points[index - 1], stroke.points[index]) <=
      radius + strokeRadius
    ) {
      return true;
    }
  }
  return false;
}

export function eraseStrokesAt(
  strokes: Stroke[],
  point: StrokePoint,
  radius: number,
): Stroke[] {
  return strokes.filter((stroke) => !strokeTouchesPoint(stroke, point, radius));
}
