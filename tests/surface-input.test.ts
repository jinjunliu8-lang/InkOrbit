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
  vi.useRealTimers();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

function setupInput(initialStrokes: Stroke[] = []) {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const nextFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const answer = document.createElement("div");
  document.body.append(answer);
  let strokes: Stroke[] = initialStrokes;
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
  function pointer(type: string, id: number, x = 100, y = 100, button = 0) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
    Object.defineProperties(event, {
      pointerId: { value: id }, pointerType: { value: "pen" }, pressure: { value: .6 },
    });
    live.dispatchEvent(event);
  }
  return { pointer, commit, captures, live, answer, nextFrame, context, getStrokes: () => strokes };
}

describe("pen interruption recovery", () => {
  it("renders the initial pen dot in the next animation frame", () => {
    const input = setupInput();
    input.pointer("pointerdown", 1);
    input.nextFrame();
    expect(input.context.arc).toHaveBeenCalledWith(100, 100, expect.any(Number), 0, Math.PI * 2);
  });

  it("forwards trackpad scrolling while the pen remains in contact", () => {
    const input = setupInput();
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } });
    document.body.append(scroller);
    scroller.append(input.answer);
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [input.answer] });
    input.pointer("pointerdown", 1);
    input.live.dispatchEvent(new WheelEvent("wheel", { cancelable: true, clientX: 100, clientY: 100, deltaY: 120 }));
    input.nextFrame();
    expect(scroller.scrollTop).toBe(120);
    input.pointer("pointermove", 1, 110, 110);
    input.pointer("pointerup", 1, 110, 110);
    expect(input.getStrokes()).toHaveLength(1);
    expect(input.getStrokes()[0].points.at(-1)).toMatchObject({ x: 110, y: 230 });
  });

  it("keeps a stationary pen contact as ink instead of switching to page dragging", () => {
    vi.useFakeTimers();
    const input = setupInput();
    input.pointer("pointerdown", 1);
    vi.advanceTimersByTime(1000);
    input.pointer("pointerup", 1);
    expect(input.getStrokes()).toHaveLength(1);
    expect(input.getStrokes()[0].points).toHaveLength(1);
  });

  it("preserves slow strokes and pressure inside the old five-pixel threshold", () => {
    vi.useFakeTimers();
    const input = setupInput();
    input.pointer("pointerdown", 1);
    vi.advanceTimersByTime(100);
    input.pointer("pointermove", 1, 101, 101);
    vi.advanceTimersByTime(100);
    input.pointer("pointermove", 1, 102, 102);
    input.pointer("pointerup", 1, 103, 103);
    expect(input.getStrokes()).toHaveLength(1);
    expect(input.getStrokes()[0].points).toHaveLength(4);
    expect(input.getStrokes()[0].points.at(-1)).toMatchObject({ x: 103, y: 103, pressure: .6 });
  });

  it("erases with the hardware eraser even when the selected tool is pen", () => {
    const input = setupInput([{
      id: "saved", color: "#000", tool: "pen", baseWidth: 3, opacity: 1,
      points: [{ x: 100, y: 100, pressure: .5, time: 0 }],
    }]);
    input.pointer("pointerdown", 1, 100, 100, 5);
    input.pointer("pointermove", 1, 120, 120, 5);
    input.pointer("pointerup", 1, 120, 120, 5);
    expect(input.getStrokes()).toHaveLength(0);
    expect(input.commit).toHaveBeenCalledTimes(1);
  });

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
