import type { Stroke } from "./types";

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const STROKE_GRID_SIZE = 256;

function strokeBounds(stroke: Stroke): Bounds | null {
  if (stroke.points.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of stroke.points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const padding = Math.max(1, stroke.baseWidth) / 2 + 2;
  return { left: left - padding, top: top - padding, right: right + padding, bottom: bottom + padding };
}

function cellRange(bounds: Bounds, cellSize: number) {
  return {
    minX: Math.floor(bounds.left / cellSize),
    maxX: Math.floor(bounds.right / cellSize),
    minY: Math.floor(bounds.top / cellSize),
    maxY: Math.floor(bounds.bottom / cellSize),
  };
}

export class StrokeGridIndex {
  private readonly cells = new Map<string, Stroke[]>();
  private all: Stroke[] = [];

  constructor(private readonly cellSize = STROKE_GRID_SIZE) {}

  private add(stroke: Stroke) {
    const bounds = strokeBounds(stroke);
    if (!bounds) return;
    const range = cellRange(bounds, this.cellSize);
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const key = `${x}:${y}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(stroke);
        else this.cells.set(key, [stroke]);
      }
    }
  }

  rebuild(strokes: Stroke[]) {
    this.cells.clear();
    this.all = strokes;
    for (const stroke of strokes) this.add(stroke);
  }

  /**
   * The common write path appends one immutable stroke. Preserve the existing
   * grid in that case so completing a stroke stays O(new strokes), not
   * O(all history). Undo, erase, migration and replacement still rebuild.
   */
  sync(strokes: Stroke[]): "unchanged" | "appended" | "rebuilt" {
    if (strokes === this.all) return "unchanged";
    const previous = this.all;
    const sharesPreviousPrefix = strokes.length >= previous.length &&
      previous.every((stroke, index) => strokes[index] === stroke);
    if (sharesPreviousPrefix && strokes.length === previous.length) {
      this.all = strokes;
      return "unchanged";
    }
    const isAppend = sharesPreviousPrefix;
    if (!isAppend) {
      this.rebuild(strokes);
      return "rebuilt";
    }
    this.all = strokes;
    for (let index = previous.length; index < strokes.length; index += 1) this.add(strokes[index]);
    return "appended";
  }

  query(bounds: Bounds): Stroke[] {
    if (this.all.length === 0) return [];
    const range = cellRange(bounds, this.cellSize);
    const seen = new Set<string>();
    const result: Stroke[] = [];
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (const stroke of this.cells.get(`${x}:${y}`) ?? []) {
          if (seen.has(stroke.id)) continue;
          seen.add(stroke.id);
          result.push(stroke);
        }
      }
    }
    return result;
  }
}

export const strokeIndexHelpers = { strokeBounds };
