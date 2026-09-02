import { describe, expect, it, vi } from "vitest";
import {
  clearAllTargets,
  isBulkClearBatchStale,
  stepBulkClearHistory,
  type BulkClearTarget,
} from "../src/bulk-clear";
import type { AnnotationController } from "../src/types";

function target(key: string, strokeCount: number, historyRevision = 0): BulkClearTarget & {
  controller: AnnotationController;
} {
  return {
    key,
    state: { strokeCount, historyRevision },
    controller: {
      activate: vi.fn(),
      setTool: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      clear: vi.fn(),
      finish: vi.fn(),
      flush: vi.fn(),
    },
  };
}

describe("conversation-wide clear", () => {
  it("clears every answer that has strokes and skips empty answers", () => {
    const first = target("first", 2, 4);
    const empty = target("empty", 0, 8);
    const third = target("third", 5, 12);

    const batch = clearAllTargets([first, empty, third]);

    expect(first.controller.clear).toHaveBeenCalledOnce();
    expect(empty.controller.clear).not.toHaveBeenCalled();
    expect(third.controller.clear).toHaveBeenCalledOnce();
    expect(batch).toEqual({
      phase: "cleared",
      revisions: { first: 5, third: 13 },
    });
  });

  it("undoes and redoes the whole clear as one grouped operation", () => {
    const first = target("first", 2, 4);
    const second = target("second", 3, 9);
    const cleared = clearAllTargets([first, second])!;

    const restored = stepBulkClearHistory([first, second], cleared, "undo");
    expect(first.controller.undo).toHaveBeenCalledOnce();
    expect(second.controller.undo).toHaveBeenCalledOnce();
    expect(restored).toEqual({
      phase: "restored",
      revisions: { first: 6, second: 11 },
    });

    const clearedAgain = stepBulkClearHistory([first, second], restored, "redo");
    expect(first.controller.redo).toHaveBeenCalledOnce();
    expect(second.controller.redo).toHaveBeenCalledOnce();
    expect(clearedAgain.phase).toBe("cleared");
  });

  it("invalidates grouped history after a new drawing revision", () => {
    const first = target("first", 0, 6);
    const batch = { phase: "cleared" as const, revisions: { first: 5 } };
    expect(isBulkClearBatchStale([first], batch)).toBe(true);
  });
});
