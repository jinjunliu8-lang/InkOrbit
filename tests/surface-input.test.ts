import { afterEach, describe, expect, it, vi } from "vitest";
import { PageDrawingSurface } from "../src/drawing-surface";
import type { Stroke } from "../src/types";

let surface: PageDrawingSurface | null = null;
afterEach(() => {
  surface?.destroy();
  surface = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupInput() {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(), clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const answer = document.createElement("div");
  document.body.append(answer);
  let strokes: Stroke[] = [];
  const commit = vi.fn((next: Stroke[]) => { strokes = next; });
  surface = new PageDrawingSurface();
  surface.register("answer", {
    element: answer,
    getSnapshot: () => ({ strokes, tool: "pen", penColor: "#000", sizes: { pen: 3, highlighter: 18, eraser: 24 } }),
    commit,
  });
  surface.activate("answer");
  const live = document.querySelector('[data-paintgpt-surface-host]')!.shadowRoot!
    .querySelector<HTMLCanvasElement>(".inkorbit-live")!;
  const captures = new Set<number>();
  live.setPointerCapture = (id) => { captures.add(id); };
  live.hasPointerCapture = (id) => captures.has(id);
  // Dispatch synchronously as well: cleanup must not finish a stroke twice.
  live.releasePointerCapture = (id) => {
    captures.delete(id);
    pointer("lostpointercapture", id);
  };
  function pointer(type: string, id: number, x = 100, y = 100) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, {
      pointerId: { value: id }, pointerType: { value: "pen" }, pressure: { value: .6 },
    });
    live.dispatchEvent(event);
  }
  return { pointer, commit, captures, getStrokes: () => strokes };
}

describe("pen interruption recovery", () => {
  it("allows writing again after pointer capture is unexpectedly lost", () => {
    const input = setupInput();
    input.pointer("pointerdown", 1);
    input.pointer("pointermove", 1, 120, 120);
    input.captures.delete(1);
    input.pointer("lostpointercapture", 1);
    input.pointer("pointerdown", 2);
    input.pointer("pointermove", 2, 140, 140);
    input.pointer("pointerup", 2);
    expect(input.commit).toHaveBeenCalledTimes(2);
    expect(input.getStrokes()).toHaveLength(2);
  });

  it("recovers a missing pointerup when the pen starts a fresh contact", () => {
    const input = setupInput();
    input.pointer("pointerdown", 1);
    input.pointer("pointermove", 1, 120, 120);
    input.pointer("pointerdown", 2, 160, 160);
    input.pointer("pointermove", 2, 180, 180);
    input.pointer("pointerup", 2);
    expect(input.getStrokes()).toHaveLength(2);
    expect(input.getStrokes()[1].points[0]).toMatchObject({ x: 160, y: 160 });
  });

  it("records the final pen position even without a last pointermove", () => {
    const input = setupInput();
    input.pointer("pointerdown", 1);
    input.pointer("pointerup", 1, 125, 130);
    expect(input.getStrokes()[0].points.at(-1)).toMatchObject({ x: 125, y: 130 });
    expect(input.commit).toHaveBeenCalledTimes(1);
  });
});
