import type { AnnotationController, AnnotationWidgetState } from "./types";

export interface BulkClearTarget {
  key: string;
  controller: AnnotationController | null;
  state: Pick<AnnotationWidgetState, "historyRevision" | "strokeCount">;
}

export interface BulkClearBatch {
  phase: "cleared" | "restored";
  revisions: Record<string, number>;
}

export function clearAllTargets(targets: readonly BulkClearTarget[]): BulkClearBatch | null {
  const clearable = targets.filter((target) => target.controller && target.state.strokeCount > 0);
  if (clearable.length === 0) return null;

  const revisions = Object.fromEntries(
    clearable.map((target) => [target.key, target.state.historyRevision + 1]),
  );
  for (const target of clearable) target.controller?.clear();
  return { phase: "cleared", revisions };
}

export function stepBulkClearHistory(
  targets: readonly BulkClearTarget[],
  batch: BulkClearBatch,
  direction: "undo" | "redo",
): BulkClearBatch {
  const nextPhase = direction === "undo" ? "restored" : "cleared";
  const targetsByKey = new Map(targets.map((target) => [target.key, target]));
  const revisions: Record<string, number> = {};

  for (const [key, revision] of Object.entries(batch.revisions)) {
    const target = targetsByKey.get(key);
    if (!target?.controller) continue;
    target.controller[direction]();
    revisions[key] = revision + 1;
  }
  return { phase: nextPhase, revisions };
}

export function isBulkClearBatchStale(
  targets: readonly BulkClearTarget[],
  batch: BulkClearBatch,
): boolean {
  const targetsByKey = new Map(targets.map((target) => [target.key, target]));
  const entries = Object.entries(batch.revisions);
  if (entries.every(([key]) => !targetsByKey.has(key))) return true;
  return entries.some(([key, revision]) => {
    const target = targetsByKey.get(key);
    return Boolean(target && target.state.historyRevision > revision);
  });
}
