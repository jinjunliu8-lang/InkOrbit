import { describe, expect, it } from "vitest";
import { annotationWidgetTestHelpers } from "../src/AnnotationWidget";
import type { AnnotationDocument } from "../src/types";

describe("legacy annotation migration", () => {
  it("maps 0.2.x answer-local points into page coordinates", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    element.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      width: 400,
      height: 300,
      right: 500,
      bottom: 500,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    const legacy: AnnotationDocument = {
      version: 1,
      conversationId: "conversation",
      messageId: "message",
      contentHash: "hash",
      canvas: { width: 800, height: 600 },
      strokes: [{
        id: "legacy",
        tool: "pen",
        color: "#000",
        baseWidth: 4,
        opacity: 1,
        points: [{ x: 400, y: 300, pressure: 0.5, time: 0 }],
      }],
      updatedAt: 1,
    };

    const [migrated] = annotationWidgetTestHelpers.migrateAnswerStrokes(legacy, element);
    expect(migrated.points[0]).toMatchObject({ x: 300, y: 350 });
    expect(migrated.baseWidth).toBe(2);
  });

  it("keeps 0.3.x page-space data unchanged", () => {
    const element = document.createElement("div");
    const pageDocument: AnnotationDocument = {
      version: 1,
      conversationId: "conversation",
      messageId: "message",
      contentHash: "hash",
      canvas: { width: 1000, height: 2000 },
      coordinateSpace: "page",
      strokes: [],
      updatedAt: 1,
    };
    expect(annotationWidgetTestHelpers.migrateAnswerStrokes(pageDocument, element)).toBe(pageDocument.strokes);
  });
});
