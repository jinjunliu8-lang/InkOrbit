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

describe("surface scroll regression", () => {
  it("redraws saved and live ink together after late overflow and reparenting", () => {
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
      for (const callback of pending) callback(0);
    };
    const contexts = new Map<HTMLCanvasElement, ReturnType<typeof makeContext>>();
    const makeContext = () => ({
      setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      if (!contexts.has(this)) contexts.set(this, makeContext());
      return contexts.get(this) as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
    const container = document.createElement("div");
    const answer = document.createElement("div");
    container.append(answer);
    document.body.append(container);
    const strokes: Stroke[] = [{
      id: "saved", color: "#000", tool: "pen", baseWidth: 3, opacity: 1,
      points: [
        { x: 100, y: 300, pressure: .5, time: 0 },
        { x: 150, y: 320, pressure: .5, time: 1 },
      ],
    }];
    surface = new PageDrawingSurface();
    surface.register("answer", {
      element: answer,
      getSnapshot: () => ({ strokes, tool: "pen", penColor: "#000", sizes: { pen: 3, highlighter: 18, eraser: 24 } }),
      commit: vi.fn(),
    });
    nextFrame();
    const shadow = document.querySelector('[data-paintgpt-surface-host]')!.shadowRoot!;
    const committed = shadow.querySelector<HTMLCanvasElement>(".inkorbit-committed")!;
    const live = shadow.querySelector<HTMLCanvasElement>(".inkorbit-live")!;
    live.setPointerCapture = vi.fn();
    live.hasPointerCapture = () => false;
    surface.activate("answer");
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperties(event, {
        pointerId: { value: 1 }, pointerType: { value: "mouse" }, pressure: { value: .5 },
      });
      live.dispatchEvent(event);
    };
    pointer("pointerdown", 200, 350);
    pointer("pointermove", 250, 370);
    nextFrame();
    container.style.overflowY = "auto";
    container.scrollTop = 200;
    container.dispatchEvent(new Event("scroll"));
    nextFrame();
    expect(contexts.get(committed)!.moveTo).toHaveBeenLastCalledWith(100, 100);
    expect(contexts.get(live)!.moveTo).toHaveBeenLastCalledWith(200, 150);
    expect(frames.size).toBe(0); // no extra frame of live-ink lag

    const replacement = document.createElement("div");
    document.body.append(replacement);
    replacement.append(answer);
    replacement.scrollTop = 100;
    replacement.dispatchEvent(new Event("scroll"));
    nextFrame();
    expect(contexts.get(committed)!.moveTo).toHaveBeenLastCalledWith(100, 200);
    expect(contexts.get(live)!.moveTo).toHaveBeenLastCalledWith(200, 250);
  });
});
