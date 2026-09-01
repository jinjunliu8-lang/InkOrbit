import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { eraseStrokesAt } from "./geometry";
import { renderStrokes } from "./renderer";
import { loadAnnotation, saveAnnotation } from "./storage";
import type {
  ActiveTool,
  AnnotationController,
  AnnotationWidgetState,
  AnswerIdentity,
  CanvasSize,
  DrawingTool,
  Stroke,
  StrokePoint,
} from "./types";

interface AnnotationWidgetProps {
  messageElement: HTMLElement;
  identity: AnswerIdentity | null;
  streaming: boolean;
  onStateChange(state: AnnotationWidgetState): void;
}

const PEN_COLORS = ["#1f2937", "#dc2626", "#2563eb"];

function makeStrokeId() {
  return globalThis.crypto?.randomUUID?.() ?? `stroke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const AnnotationWidget = forwardRef<AnnotationController, AnnotationWidgetProps>(function AnnotationWidget({
  messageElement,
  identity,
  streaming,
  onStateChange,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const baseSizeRef = useRef<CanvasSize>({ width: 0, height: 0 });
  const displaySizeRef = useRef<CanvasSize>({ width: 0, height: 0 });
  const pastRef = useRef<Stroke[][]>([]);
  const futureRef = useRef<Stroke[][]>([]);
  const activePointerRef = useRef<number | null>(null);
  const eraseBeforeRef = useRef<Stroke[] | null>(null);
  const eraseChangedRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<ActiveTool>("pen");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [sizes, setSizes] = useState({ pen: 3, highlighter: 18, eraser: 24 });
  const [loading, setLoading] = useState(true);
  const [contentMismatch, setContentMismatch] = useState(false);
  const [layoutMismatch, setLayoutMismatch] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);

  const drawNow = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const visibleStrokes = currentStrokeRef.current
      ? [...strokesRef.current, currentStrokeRef.current]
      : strokesRef.current;
    renderStrokes(
      context,
      visibleStrokes,
      baseSizeRef.current,
      displaySizeRef.current,
      Math.max(1, window.devicePixelRatio || 1),
    );
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawNow();
    });
  }, [drawNow]);

  const persist = useCallback(
    async (nextStrokes: Stroke[]) => {
      if (!identity || baseSizeRef.current.width <= 0 || baseSizeRef.current.height <= 0) return;
      try {
        await saveAnnotation({
          version: 1,
          ...identity,
          canvas: baseSizeRef.current,
          strokes: nextStrokes,
          updatedAt: Date.now(),
        });
        setStorageError(false);
        setContentMismatch(false);
      } catch (error) {
        console.warn("[答案批注画板] 保存批注失败", error);
        setStorageError(true);
      }
    },
    [identity],
  );

  const setVisibleStrokes = useCallback(
    (nextStrokes: Stroke[], shouldPersist = false) => {
      strokesRef.current = nextStrokes;
      setStrokes(nextStrokes);
      scheduleDraw();
      if (shouldPersist) void persist(nextStrokes);
    },
    [persist, scheduleDraw],
  );

  const commit = useCallback(
    (nextStrokes: Stroke[]) => {
      if (nextStrokes === strokesRef.current) return;
      pastRef.current.push(strokesRef.current);
      futureRef.current = [];
      setVisibleStrokes(nextStrokes, true);
      setHistoryRevision((revision) => revision + 1);
    },
    [setVisibleStrokes],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditing(false);
    pastRef.current = [];
    futureRef.current = [];
    setHistoryRevision((revision) => revision + 1);

    if (!identity) {
      setVisibleStrokes([]);
      return () => {
        cancelled = true;
      };
    }

    void loadAnnotation(identity)
      .then((loaded) => {
        if (cancelled) return;
        const rect = messageElement.getBoundingClientRect();
        baseSizeRef.current = loaded.document?.canvas ?? {
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
        };
        setVisibleStrokes(loaded.document?.strokes ?? []);
        setContentMismatch(loaded.contentMismatch);
        setStorageError(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[答案批注画板] 读取批注失败", error);
        const rect = messageElement.getBoundingClientRect();
        baseSizeRef.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
        setVisibleStrokes([]);
        setStorageError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity?.conversationId, identity?.messageId, identity?.contentHash]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const displaySize = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      displaySizeRef.current = displaySize;
      if (baseSizeRef.current.width <= 0 || baseSizeRef.current.height <= 0) {
        baseSizeRef.current = displaySize;
      }
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(displaySize.width * ratio));
      const pixelHeight = Math.max(1, Math.round(displaySize.height * ratio));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

      const baseAspect = baseSizeRef.current.width / baseSizeRef.current.height;
      const displayAspect = displaySize.width / displaySize.height;
      const mismatch =
        strokesRef.current.length > 0 && Math.abs(displayAspect - baseAspect) / baseAspect > 0.06;
      setLayoutMismatch(mismatch);
      scheduleDraw();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(messageElement);
    resize();
    return () => observer.disconnect();
  }, [messageElement, scheduleDraw]);

  useEffect(() => {
    strokesRef.current = strokes;
    scheduleDraw();
  }, [strokes, scheduleDraw]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const eventToPoint = (event: PointerEvent): StrokePoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const base = baseSizeRef.current;
    const pressure = event.pointerType === "mouse" ? 0.5 : event.pressure > 0 ? event.pressure : 0.5;
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * base.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * base.height,
      pressure,
      time: event.timeStamp,
    };
  };

  const eraseAtEvent = (event: PointerEvent) => {
    const point = eventToPoint(event);
    const scaleX = displaySizeRef.current.width / baseSizeRef.current.width;
    const scaleY = displaySizeRef.current.height / baseSizeRef.current.height;
    const radius = sizes.eraser / Math.max(0.01, (scaleX + scaleY) / 2) / 2;
    const next = eraseStrokesAt(strokesRef.current, point, radius);
    if (next.length !== strokesRef.current.length) {
      eraseChangedRef.current = true;
      setVisibleStrokes(next);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!editing || event.pointerType === "touch" || activePointerRef.current !== null) return;
    if (event.button !== 0 && event.pointerType !== "pen") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;

    const useEraser = tool === "eraser" || (event.pointerType === "pen" && event.button === 5);
    if (useEraser) {
      eraseBeforeRef.current = strokesRef.current;
      eraseChangedRef.current = false;
      eraseAtEvent(event.nativeEvent);
      return;
    }

    const drawingTool = tool as DrawingTool;
    currentStrokeRef.current = {
      id: makeStrokeId(),
      tool: drawingTool,
      color: drawingTool === "highlighter" ? "#facc15" : penColor,
      baseWidth: sizes[drawingTool],
      opacity: drawingTool === "highlighter" ? 0.3 : 1,
      points: [eventToPoint(event.nativeEvent)],
    };
    scheduleDraw();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const nativeEvents = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    if (currentStrokeRef.current) {
      for (const nativeEvent of nativeEvents) {
        const point = eventToPoint(nativeEvent);
        const previous = currentStrokeRef.current.points.at(-1);
        if (!previous || previous.x !== point.x || previous.y !== point.y) {
          currentStrokeRef.current.points.push(point);
        }
      }
      scheduleDraw();
      return;
    }
    for (const nativeEvent of nativeEvents) eraseAtEvent(nativeEvent);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (currentStrokeRef.current) {
      const completed = currentStrokeRef.current;
      currentStrokeRef.current = null;
      commit([...strokesRef.current, completed]);
      return;
    }

    if (eraseChangedRef.current && eraseBeforeRef.current) {
      pastRef.current.push(eraseBeforeRef.current);
      futureRef.current = [];
      void persist(strokesRef.current);
      setHistoryRevision((revision) => revision + 1);
    }
    eraseBeforeRef.current = null;
    eraseChangedRef.current = false;
    scheduleDraw();
  };

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(strokesRef.current);
    setVisibleStrokes(previous, true);
    setHistoryRevision((revision) => revision + 1);
  }, [setVisibleStrokes]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(strokesRef.current);
    setVisibleStrokes(next, true);
    setHistoryRevision((revision) => revision + 1);
  }, [setVisibleStrokes]);

  const clear = useCallback(() => {
    if (strokesRef.current.length) commit([]);
  }, [commit]);

  useImperativeHandle(
    ref,
    () => ({
      activate(nextTool = "pen") {
        if (streaming || loading || !identity) return;
        setTool(nextTool);
        setEditing(true);
      },
      setTool(nextTool, settings) {
        setTool(nextTool);
        if (settings?.color && nextTool === "pen") setPenColor(settings.color);
        if (settings?.size !== undefined) {
          setSizes((current) => ({ ...current, [nextTool]: settings.size! }));
        }
      },
      undo,
      redo,
      clear,
      finish() {
        setEditing(false);
      },
    }),
    [clear, identity, loading, redo, streaming, undo],
  );

  useEffect(() => {
    onStateChange({
      editing,
      tool,
      penColor,
      sizes,
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
      strokeCount: strokes.length,
      ready: !loading && Boolean(identity),
      streaming,
    });
  }, [editing, historyRevision, identity, loading, onStateChange, penColor, sizes, streaming, strokes.length, tool]);

  const warning = storageError
    ? "本地保存失败，请检查浏览器存储权限"
    : contentMismatch || layoutMismatch
      ? "答案或排版发生变化，旧批注可能轻微错位"
      : null;

  return (
    <div className={`paintgpt-layer${editing ? " is-editing" : ""}`}>
      <canvas
        ref={canvasRef}
        className="paintgpt-canvas"
        aria-label="答案批注画布"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      />

      {warning && <div className="paintgpt-warning">{warning}</div>}
    </div>
  );
});
