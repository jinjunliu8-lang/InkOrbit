import { strokeTouchesPoint } from "./geometry";
import { renderPageStrokeSegments } from "./renderer";
import { StrokeGridIndex, type Bounds } from "./stroke-index";
import type { ActiveTool, Stroke, StrokePoint, ToolSizes } from "./types";

const LONG_PRESS_MS = 180;
const MOVE_TOLERANCE = 5;
const HIGH_QUALITY_IDLE_MS = 120;
const INTERACTIVE_RATIOS = [1, 1.25, 1.5] as const;

interface SurfaceSnapshot {
  strokes: Stroke[];
  tool: ActiveTool;
  penColor: string;
  sizes: ToolSizes;
}

export interface DrawingSurfaceSession {
  element: HTMLElement;
  getSnapshot(): SurfaceSnapshot;
  commit(strokes: Stroke[]): void;
}

interface RegisteredSession {
  session: DrawingSurfaceSession;
  source: Stroke[] | null;
  index: StrokeGridIndex;
}

interface ScrollTargets {
  horizontal: HTMLElement | Window | null;
  vertical: HTMLElement | Window | null;
}

type GestureMode = "pending" | "drawing" | "erasing" | "panning";

interface Gesture {
  pointerId: number;
  pointerType: string;
  mode: GestureMode;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  longPressTimer: number | null;
  stroke: Stroke | null;
  renderedPointCount: number;
  originalStrokes: Stroke[] | null;
  workingStrokes: Stroke[] | null;
  erasedIds: Set<string>;
  scrollTargets: ScrollTargets | null;
  ratio: number;
}

function makeStrokeId() {
  return globalThis.crypto?.randomUUID?.() ?? `stroke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"));
}

function overflowAllows(value: string) {
  return /(auto|scroll|overlay)/.test(value);
}

function canScroll(element: HTMLElement, axis: "x" | "y") {
  const style = getComputedStyle(element);
  return axis === "x"
    ? overflowAllows(style.overflowX) && element.scrollWidth > element.clientWidth
    : overflowAllows(style.overflowY) && element.scrollHeight > element.clientHeight;
}

function nearestScrollable(element: Element | null, axis: "x" | "y"): HTMLElement | null {
  for (let current = element instanceof HTMLElement ? element : element?.parentElement; current; current = current.parentElement) {
    if (canScroll(current, axis)) return current;
  }
  return null;
}

function scrollByAxis(target: HTMLElement | Window | null, axis: "x" | "y", delta: number) {
  if (!target || delta === 0) return;
  if (!(target instanceof HTMLElement)) {
    window.scrollBy(axis === "x" ? delta : 0, axis === "y" ? delta : 0);
    return;
  }
  if (axis === "x") target.scrollLeft += delta;
  else target.scrollTop += delta;
}

function findPrimaryScroller(element: HTMLElement): HTMLElement | null {
  return nearestScrollable(element, "y");
}

function viewportOrigin(scroller: HTMLElement | null) {
  return {
    x: window.scrollX + (scroller?.scrollLeft ?? 0),
    y: window.scrollY + (scroller?.scrollTop ?? 0),
  };
}

function pointFromEvent(event: PointerEvent, scroller: HTMLElement | null): StrokePoint {
  const origin = viewportOrigin(scroller);
  return {
    x: event.clientX + origin.x,
    y: event.clientY + origin.y,
    pressure: event.pointerType === "mouse" ? 0.5 : event.pressure > 0 ? event.pressure : 0.5,
    time: event.timeStamp,
  };
}

function movement(startX: number, startY: number, x: number, y: number) {
  return Math.hypot(x - startX, y - startY);
}

function shouldStartDrawing(startX: number, startY: number, x: number, y: number) {
  return movement(startX, startY, x, y) > MOVE_TOLERANCE;
}

function classifyPendingGesture(elapsedMs: number, distancePx: number): "pending" | "drawing" | "panning" {
  if (distancePx > MOVE_TOLERANCE) return "drawing";
  return elapsedMs >= LONG_PRESS_MS ? "panning" : "pending";
}

function surfaceStyles() {
  return `
    :host { position: fixed; inset: 0; pointer-events: none; }
    *, *::before, *::after { box-sizing: border-box; }
    .inkorbit-surface { position: fixed; inset: 0; pointer-events: none; }
    canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
    .inkorbit-surface.is-editing .inkorbit-live { pointer-events: auto; cursor: crosshair; touch-action: none; }
    .inkorbit-surface.is-panning .inkorbit-live { cursor: grabbing; }
  `;
}

export class PageDrawingSurface {
  private readonly host = document.createElement("div");
  private readonly root = document.createElement("div");
  private readonly committed = document.createElement("canvas");
  private readonly live = document.createElement("canvas");
  private readonly sessions = new Map<string, RegisteredSession>();
  private activeId: string | null = null;
  private gesture: Gesture | null = null;
  private committedFrame: number | null = null;
  private liveFrame: number | null = null;
  private idleQualityTimer: number | null = null;
  private scrollFrame: number | null = null;
  private spaceDown = false;
  private interactiveRatioIndex = 2;
  private averageFrameMs = 0;

  constructor() {
    this.host.dataset.paintgptSurfaceHost = "true";
    this.host.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = surfaceStyles();
    this.root.className = "inkorbit-surface";
    this.committed.className = "inkorbit-committed";
    this.live.className = "inkorbit-live";
    this.committed.setAttribute("aria-hidden", "true");
    this.live.setAttribute("aria-label", "整页批注画布");
    this.root.append(this.committed, this.live);
    shadow.append(style, this.root);
    document.documentElement.appendChild(this.host);

    this.live.addEventListener("pointerdown", this.onPointerDown);
    this.live.addEventListener("pointermove", this.onPointerMove);
    if ("onpointerrawupdate" in window) this.live.addEventListener("pointerrawupdate", this.onPointerMove as EventListener);
    this.live.addEventListener("pointerup", this.onPointerUp);
    this.live.addEventListener("pointercancel", this.onPointerCancel);
    this.live.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("scroll", this.onScroll, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("resize", this.onResize);
    this.committed.width = 1;
    this.committed.height = 1;
    this.live.width = 1;
    this.live.height = 1;
  }

  register(id: string, session: DrawingSurfaceSession) {
    this.sessions.set(id, { session, source: null, index: new StrokeGridIndex() });
    this.scheduleCommittedDraw();
    return () => {
      if (this.activeId === id) this.deactivate(id);
      this.sessions.delete(id);
      this.scheduleCommittedDraw();
    };
  }

  refresh(id: string) {
    const registered = this.sessions.get(id);
    if (registered) registered.source = null;
    this.scheduleCommittedDraw();
  }

  activate(id: string) {
    if (!this.sessions.has(id)) return;
    this.activeId = id;
    this.root.classList.add("is-editing");
    this.resizeCanvas(this.live, this.interactiveRatio());
    this.clearCanvas(this.live);
  }

  deactivate(id?: string) {
    if (id && this.activeId !== id) return;
    this.cancelGesture(false);
    this.activeId = null;
    this.root.classList.remove("is-editing", "is-panning");
    this.clearCanvas(this.live);
    this.live.width = 1;
    this.live.height = 1;
    this.scheduleHighQualityDraw();
  }

  destroy() {
    this.cancelGesture(false);
    if (this.committedFrame !== null) cancelAnimationFrame(this.committedFrame);
    if (this.liveFrame !== null) cancelAnimationFrame(this.liveFrame);
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    if (this.idleQualityTimer !== null) window.clearTimeout(this.idleQualityTimer);
    this.live.removeEventListener("pointerdown", this.onPointerDown);
    this.live.removeEventListener("pointermove", this.onPointerMove);
    if ("onpointerrawupdate" in window) this.live.removeEventListener("pointerrawupdate", this.onPointerMove as EventListener);
    this.live.removeEventListener("pointerup", this.onPointerUp);
    this.live.removeEventListener("pointercancel", this.onPointerCancel);
    this.live.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("scroll", this.onScroll, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("resize", this.onResize);
    this.host.remove();
  }

  private activeSession() {
    return this.activeId ? this.sessions.get(this.activeId)?.session ?? null : null;
  }

  private interactiveRatio() {
    return Math.min(devicePixelRatio || 1, INTERACTIVE_RATIOS[this.interactiveRatioIndex]);
  }

  private highQualityRatio() {
    return Math.min(devicePixelRatio || 1, 2);
  }

  private resizeCanvas(canvas: HTMLCanvasElement, ratio: number) {
    const width = Math.max(1, Math.round(innerWidth * ratio));
    const height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.dataset.ratio = String(ratio);
  }

  private canvasRatio(canvas: HTMLCanvasElement) {
    return Number(canvas.dataset.ratio) || 1;
  }

  private clearCanvas(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = this.canvasRatio(canvas);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, innerWidth, innerHeight);
  }

  private ensureIndex(registered: RegisteredSession) {
    const strokes = registered.session.getSnapshot().strokes;
    if (registered.source !== strokes) {
      registered.source = strokes;
      registered.index.rebuild(strokes);
    }
    return registered;
  }

  private visibleBounds(scroller: HTMLElement | null): Bounds {
    const origin = viewportOrigin(scroller);
    return {
      left: origin.x - 32,
      top: origin.y - 32,
      right: origin.x + innerWidth + 32,
      bottom: origin.y + innerHeight + 32,
    };
  }

  private drawCommitted = (ratio = this.canvasRatio(this.committed)) => {
    const started = performance.now();
    const hasAnyInk = Array.from(this.sessions.values()).some(
      (registered) => registered.session.getSnapshot().strokes.length > 0,
    );
    if (!hasAnyInk) {
      this.committed.width = 1;
      this.committed.height = 1;
      this.committed.dataset.ratio = "1";
      return;
    }
    this.resizeCanvas(this.committed, ratio);
    this.clearCanvas(this.committed);
    const context = this.committed.getContext("2d");
    if (!context) return;
    for (const [id, registered] of this.sessions) {
      const scroller = findPrimaryScroller(registered.session.element);
      const origin = viewportOrigin(scroller);
      const isWorkingErase = id === this.activeId && this.gesture?.mode === "erasing" && this.gesture.workingStrokes;
      const indexed = isWorkingErase ? registered : this.ensureIndex(registered);
      for (const stroke of indexed.index.query(this.visibleBounds(scroller))) {
        renderPageStrokeSegments(context, stroke, 0, origin, ratio);
      }
    }
    this.recordFrame(performance.now() - started);
  };

  private scheduleCommittedDraw() {
    if (this.committedFrame !== null) return;
    this.committedFrame = requestAnimationFrame(() => {
      this.committedFrame = null;
      this.drawCommitted();
    });
  }

  private scheduleHighQualityDraw() {
    if (this.idleQualityTimer !== null) window.clearTimeout(this.idleQualityTimer);
    this.idleQualityTimer = window.setTimeout(() => {
      this.idleQualityTimer = null;
      this.drawCommitted(this.highQualityRatio());
    }, HIGH_QUALITY_IDLE_MS);
  }

  private recordFrame(duration: number) {
    this.averageFrameMs = this.averageFrameMs === 0 ? duration : this.averageFrameMs * 0.78 + duration * 0.22;
    if (this.gesture) return;
    if (this.averageFrameMs > 11 && this.interactiveRatioIndex > 0) this.interactiveRatioIndex -= 1;
    else if (this.averageFrameMs < 5 && this.interactiveRatioIndex < INTERACTIVE_RATIOS.length - 1) this.interactiveRatioIndex += 1;
  }

  private createStroke(event: PointerEvent, session: DrawingSurfaceSession) {
    const snapshot = session.getSnapshot();
    const drawingTool = snapshot.tool === "highlighter" ? "highlighter" : "pen";
    return {
      id: makeStrokeId(),
      tool: drawingTool,
      color: drawingTool === "highlighter" ? "#facc15" : snapshot.penColor,
      baseWidth: snapshot.sizes[drawingTool],
      opacity: drawingTool === "highlighter" ? 0.3 : 1,
      points: [pointFromEvent(event, findPrimaryScroller(session.element))],
    } satisfies Stroke;
  }

  private chooseScrollTargets(event: PointerEvent, session: DrawingSurfaceSession): ScrollTargets {
    const elements = document.elementsFromPoint(event.clientX, event.clientY);
    const underlying = elements.find((element) =>
      element !== this.host && !this.host.contains(element) &&
      !element.closest('[data-paintgpt-floating-host="true"]')) ?? session.element;
    const horizontal = nearestScrollable(underlying, "x");
    const vertical = nearestScrollable(underlying, "y") ?? findPrimaryScroller(session.element);
    return {
      horizontal: horizontal ?? (document.documentElement.scrollWidth > innerWidth ? window : null),
      vertical: vertical ?? window,
    };
  }

  private enterPan(event: PointerEvent, gesture: Gesture, session: DrawingSurfaceSession) {
    if (gesture.longPressTimer !== null) window.clearTimeout(gesture.longPressTimer);
    gesture.longPressTimer = null;
    gesture.mode = "panning";
    gesture.stroke = null;
    gesture.scrollTargets = this.chooseScrollTargets(event, session);
    this.clearCanvas(this.live);
    this.root.classList.add("is-panning");
  }

  private startDrawing(gesture: Gesture) {
    if (gesture.longPressTimer !== null) window.clearTimeout(gesture.longPressTimer);
    gesture.longPressTimer = null;
    gesture.mode = "drawing";
  }

  private startErasing(gesture: Gesture) {
    if (gesture.longPressTimer !== null) window.clearTimeout(gesture.longPressTimer);
    gesture.longPressTimer = null;
    gesture.mode = "erasing";
  }

  private queueLiveDraw() {
    if (this.liveFrame !== null) return;
    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = null;
      const gesture = this.gesture;
      const session = this.activeSession();
      if (!gesture?.stroke || !session || gesture.mode !== "drawing") return;
      const context = this.live.getContext("2d");
      if (!context) return;
      const started = performance.now();
      renderPageStrokeSegments(
        context,
        gesture.stroke,
        gesture.renderedPointCount,
        viewportOrigin(findPrimaryScroller(session.element)),
        gesture.ratio,
      );
      gesture.renderedPointCount = gesture.stroke.points.length;
      this.recordFrame(performance.now() - started);
    });
  }

  private eraseAt(event: PointerEvent, gesture: Gesture, session: DrawingSurfaceSession) {
    const snapshot = session.getSnapshot();
    const point = pointFromEvent(event, findPrimaryScroller(session.element));
    const registered = this.activeId ? this.sessions.get(this.activeId) : null;
    if (!registered) return;
    this.ensureIndex(registered);
    const radius = snapshot.sizes.eraser / 2;
    const candidates = registered.index.query({
      left: point.x - radius - 48,
      top: point.y - radius - 48,
      right: point.x + radius + 48,
      bottom: point.y + radius + 48,
    });
    let changed = false;
    for (const stroke of candidates) {
      if (!gesture.erasedIds.has(stroke.id) && strokeTouchesPoint(stroke, point, radius)) {
        gesture.erasedIds.add(stroke.id);
        changed = true;
      }
    }
    if (!changed) return;
    gesture.workingStrokes = (gesture.originalStrokes ?? snapshot.strokes)
      .filter((stroke) => !gesture.erasedIds.has(stroke.id));
    if (registered) {
      registered.source = gesture.workingStrokes;
      registered.index.rebuild(gesture.workingStrokes);
    }
    this.scheduleCommittedDraw();
  }

  private finishGesture(commit: boolean) {
    const gesture = this.gesture;
    const session = this.activeSession();
    if (!gesture) return;
    if (gesture.longPressTimer !== null) window.clearTimeout(gesture.longPressTimer);
    if (this.live.hasPointerCapture(gesture.pointerId)) this.live.releasePointerCapture(gesture.pointerId);

    if (commit && session) {
      if ((gesture.mode === "drawing" || gesture.mode === "pending") && gesture.stroke) {
        session.commit([...session.getSnapshot().strokes, gesture.stroke]);
      } else if (gesture.mode === "erasing" && gesture.workingStrokes && gesture.erasedIds.size > 0) {
        session.commit(gesture.workingStrokes);
      }
    }
    this.gesture = null;
    this.root.classList.remove("is-panning");
    this.clearCanvas(this.live);
    this.resizeCanvas(this.live, this.interactiveRatio());
    this.scheduleCommittedDraw();
    this.scheduleHighQualityDraw();
  }

  private cancelGesture(commit: boolean) {
    if (!this.gesture) return;
    this.finishGesture(commit);
  }

  private onPointerDown = (event: PointerEvent) => {
    const session = this.activeSession();
    if (!session || this.gesture) return;
    const isMiddleMouse = event.pointerType === "mouse" && event.button === 1;
    const isPenSideButton = event.pointerType === "pen" && (event.button === 2 || event.buttons === 2);
    const isPenEraser = event.pointerType === "pen" && event.button === 5;
    const immediatePan = event.pointerType === "touch" || isMiddleMouse || isPenSideButton || this.spaceDown;
    if (!immediatePan && event.button !== 0 && !isPenEraser) return;
    if (event.cancelable) event.preventDefault();
    this.live.setPointerCapture(event.pointerId);
    const snapshot = session.getSnapshot();
    const shouldErase = !immediatePan && (snapshot.tool === "eraser" || isPenEraser);
    const ratio = this.interactiveRatio();
    this.resizeCanvas(this.live, ratio);
    this.clearCanvas(this.live);
    const gesture: Gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      mode: immediatePan ? "panning" : event.pointerType === "pen" ? "pending" : shouldErase ? "erasing" : "drawing",
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      longPressTimer: null,
      stroke: shouldErase || immediatePan ? null : this.createStroke(event, session),
      renderedPointCount: 0,
      originalStrokes: shouldErase ? snapshot.strokes : null,
      workingStrokes: shouldErase ? snapshot.strokes : null,
      erasedIds: new Set(),
      scrollTargets: immediatePan ? this.chooseScrollTargets(event, session) : null,
      ratio,
    };
    this.gesture = gesture;

    if (immediatePan) {
      this.root.classList.add("is-panning");
    } else if (event.pointerType === "pen") {
      if (gesture.stroke) this.queueLiveDraw();
      gesture.longPressTimer = window.setTimeout(() => {
        if (this.gesture === gesture && gesture.mode === "pending") this.enterPan(event, gesture, session);
      }, LONG_PRESS_MS);
    } else if (shouldErase) {
      this.eraseAt(event, gesture, session);
    } else {
      this.queueLiveDraw();
    }
  };

  private onPointerMove = (event: PointerEvent) => {
    const gesture = this.gesture;
    const session = this.activeSession();
    if (!gesture || !session || gesture.pointerId !== event.pointerId) return;
    if (event.cancelable) event.preventDefault();
    const movedToDrawing = shouldStartDrawing(
      gesture.startClientX,
      gesture.startClientY,
      event.clientX,
      event.clientY,
    );
    const wasPending = gesture.mode === "pending";
    if (wasPending && gesture.stroke) {
      const scroller = findPrimaryScroller(session.element);
      for (const sample of event.getCoalescedEvents?.() ?? [event]) {
        const point = pointFromEvent(sample, scroller);
        const previous = gesture.stroke.points.at(-1);
        if (!previous || previous.x !== point.x || previous.y !== point.y) gesture.stroke.points.push(point);
      }
    }
    if (gesture.mode === "pending" && movedToDrawing) {
      if (session.getSnapshot().tool === "eraser") {
        gesture.stroke = null;
        gesture.originalStrokes = session.getSnapshot().strokes;
        gesture.workingStrokes = gesture.originalStrokes;
        this.startErasing(gesture);
      } else {
        this.startDrawing(gesture);
      }
    }

    if (gesture.mode === "panning") {
      const deltaX = event.clientX - gesture.lastClientX;
      const deltaY = event.clientY - gesture.lastClientY;
      scrollByAxis(gesture.scrollTargets?.horizontal ?? null, "x", -deltaX);
      scrollByAxis(gesture.scrollTargets?.vertical ?? null, "y", -deltaY);
    } else if (gesture.mode === "drawing" && gesture.stroke) {
      if (wasPending) {
        this.queueLiveDraw();
        gesture.lastClientX = event.clientX;
        gesture.lastClientY = event.clientY;
        return;
      }
      const coalesced = event.getCoalescedEvents?.() ?? [event];
      const scroller = findPrimaryScroller(session.element);
      for (const sample of coalesced) {
        const point = pointFromEvent(sample, scroller);
        const previous = gesture.stroke.points.at(-1);
        if (!previous || previous.x !== point.x || previous.y !== point.y) gesture.stroke.points.push(point);
      }
      this.queueLiveDraw();
    } else if (gesture.mode === "erasing") {
      for (const sample of event.getCoalescedEvents?.() ?? [event]) this.eraseAt(sample, gesture, session);
    }
    gesture.lastClientX = event.clientX;
    gesture.lastClientY = event.clientY;
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.gesture?.pointerId !== event.pointerId) return;
    event.preventDefault();
    const session = this.activeSession();
    if (session && this.gesture.mode === "pending" && !this.gesture.stroke) {
      this.startErasing(this.gesture);
      this.eraseAt(event, this.gesture, session);
    }
    this.finishGesture(true);
  };

  private onPointerCancel = (event: PointerEvent) => {
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.finishGesture(false);
  };

  private onContextMenu = (event: MouseEvent) => {
    if (this.activeId) event.preventDefault();
  };

  private onScroll = () => {
    if (this.scrollFrame === null) {
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = null;
        const ratio = this.gesture ? this.interactiveRatio() : this.canvasRatio(this.committed);
        this.drawCommitted(ratio);
        if (this.gesture?.stroke) {
          this.clearCanvas(this.live);
          this.gesture.renderedPointCount = 0;
          this.queueLiveDraw();
        }
      });
    }
    this.scheduleHighQualityDraw();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Space" || isEditableTarget(event.target) || !this.activeId) return;
    this.spaceDown = true;
    event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space") this.spaceDown = false;
  };

  private onWindowBlur = () => {
    this.spaceDown = false;
    this.cancelGesture(false);
  };

  private onResize = () => {
    if (this.activeId) this.resizeCanvas(this.live, this.interactiveRatio());
    else {
      this.live.width = 1;
      this.live.height = 1;
    }
    this.drawCommitted(this.highQualityRatio());
  };
}

export const drawingGestureConstants = { LONG_PRESS_MS, MOVE_TOLERANCE };
export const drawingSurfaceTestHelpers = { movement, shouldStartDrawing, classifyPendingGesture };
