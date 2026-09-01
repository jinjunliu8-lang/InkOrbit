import { beforeEach, describe, expect, it } from "vitest";
import { loadAnnotation, saveAnnotation } from "../src/storage";
import type { AnnotationDocument, AnswerIdentity } from "../src/types";

const identity: AnswerIdentity = {
  conversationId: "conversation",
  messageId: "message",
  contentHash: "hash-a",
};

const documentRecord: AnnotationDocument = {
  version: 1,
  ...identity,
  canvas: { width: 800, height: 600 },
  strokes: [],
  updatedAt: 1,
};

describe("annotation storage", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("paintgpt-answer-annotations");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("loads the exact answer revision", async () => {
    await saveAnnotation(documentRecord);
    const loaded = await loadAnnotation(identity);
    expect(loaded.contentMismatch).toBe(false);
    expect(loaded.document?.canvas).toEqual({ width: 800, height: 600 });
  });

  it("recovers the latest annotation for a changed answer and warns", async () => {
    await saveAnnotation(documentRecord);
    const loaded = await loadAnnotation({ ...identity, contentHash: "hash-b" });
    expect(loaded.contentMismatch).toBe(true);
    expect(loaded.document?.contentHash).toBe("hash-a");
  });
});
