import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { DrawingSurfaceSession, PageDrawingSurface } from "./drawing-surface";
import { loadAnnotation, saveAnnotation } from "./storage";
import { findPrimaryScroller as findScrollContainer, pageOrigin as viewportOrigin } from "./page-coordinates";
import type {
  ActiveTool,
  AnnotationController,
  AnnotationDocument,
  AnnotationWidgetState,
  AnswerIdentity,
  CanvasSize,
  Stroke,
  ToolSizes,
} from "./types";

interface AnnotationWidgetProps {
  documentId: string;
  messageElement: HTMLElement;
  identity: AnswerIdentity | null;
  streaming: boolean;
  surface: PageDrawingSurface;
  onStateChange(state: AnnotationWidgetState): void;
}

const DEFAULT_PEN_COLOR = "#1f2937";
const DEFAULT_SIZES: ToolSizes = { pen: 3, highlighter: 18, eraser: 24 };

function pageSize(element: HTMLElement): CanvasSize {
  const scroller = findScrollContainer(element);
  return {
    width: Math.max(innerWidth, document.documentElement.scrollWidth, scroller?.scrollWidth ?? 0),
    height: Math.max(innerHeight, document.documentElement.scrollHeight, scroller?.scrollHeight ?? 0),
  };
}

function migrateAnswerStrokes(documentRecord: AnnotationDocument, element: HTMLElement): Stroke[] {
  if (documentRecord.coordinateSpace === "page") return documentRecord.strokes;
  const rect = element.getBoundingClientRect();
  const origin = viewportOrigin(element);
  const scaleX = rect.width / Math.max(1, documentRecord.canvas.width);
  const scaleY = rect.height / Math.max(1, documentRecord.canvas.height);
  const widthScale = (scaleX + scaleY) / 2;
  return documentRecord.strokes.map((stroke) => ({
    ...stroke,
    baseWidth: stroke.baseWidth * widthScale,
    points: stroke.points.map((point) => ({
      ...point,
      x: origin.x + rect.left + point.x * scaleX,
      y: origin.y + rect.top + point.y * scaleY,
    })),
  }));
}

export const annotationWidgetTestHelpers = { migrateAnswerStrokes };

export const AnnotationWidget = forwardRef<AnnotationController, AnnotationWidgetProps>(function AnnotationWidget({
  documentId,
  messageElement,
  identity,
  streaming,
  surface,
  onStateChange,
}, ref) {
  const strokesRef = useRef<Stroke[]>([]);
  const toolRef = useRef<ActiveTool>("pen");
  const penColorRef = useRef(DEFAULT_PEN_COLOR);
  const sizesRef = useRef<ToolSizes>(DEFAULT_SIZES);
  const identityRef = useRef<AnswerIdentity | null>(identity);
  const pendingDocumentRef = useRef<AnnotationDocument | null>(null);
  const idleHandleRef = useRef<number | null>(null);
  const idleHandleKindRef = useRef<"idle" | "timeout" | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pastRef = useRef<Stroke[][]>([]);
  const futureRef = useRef<Stroke[][]>([]);
  const commitRef = useRef<(next: Stroke[]) => void>(() => undefined);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [editing, setEditing] = useState(false);
  const [tool, setToolState] = useState<ActiveTool>("pen");
  const [penColor, setPenColorState] = useState(DEFAULT_PEN_COLOR);
  const [sizes, setSizesState] = useState<ToolSizes>(DEFAULT_SIZES);
  const [loading, setLoading] = useState(true);
  const [historyRevision, setHistoryRevision] = useState(0);

  identityRef.current = identity;

  const cancelScheduledSave = useCallback(() => {
    if (idleHandleRef.current === null) return;
    if (idleHandleKindRef.current === "idle") window.cancelIdleCallback(idleHandleRef.current);
    else window.clearTimeout(idleHandleRef.current);
    idleHandleRef.current = null;
    idleHandleKindRef.current = null;
  }, []);

  const flushPersist = useCallback(() => {
    cancelScheduledSave();
    const documentRecord = pendingDocumentRef.current;
    if (!documentRecord) return;
    pendingDocumentRef.current = null;
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(() => saveAnnotation(documentRecord))
      .catch((error) => console.warn("[InkOrbit] 保存批注失败", error));
  }, [cancelScheduledSave]);

  const schedulePersist = useCallback((nextStrokes: Stroke[]) => {
    const currentIdentity = identityRef.current;
    if (!currentIdentity) return;
    pendingDocumentRef.current = {
      version: 1,
      ...currentIdentity,
      canvas: pageSize(messageElement),
      coordinateSpace: "page",
      strokes: nextStrokes,
      updatedAt: Date.now(),
    };
    if (idleHandleRef.current !== null) return;
    if (typeof window.requestIdleCallback === "function") {
      idleHandleKindRef.current = "idle";
      idleHandleRef.current = window.requestIdleCallback(() => flushPersist(), { timeout: 900 });
    } else {
      idleHandleKindRef.current = "timeout";
      idleHandleRef.current = window.setTimeout(() => flushPersist(), 350);
    }
  }, [flushPersist, messageElement]);

  const setVisibleStrokes = useCallback((next: Stroke[], persist = false) => {
    strokesRef.current = next;
    setStrokes(next);
    surface.refresh(documentId);
    if (persist) schedulePersist(next);
  }, [documentId, schedulePersist, surface]);

  const commit = useCallback((next: Stroke[]) => {
    if (next === strokesRef.current) return;
    pastRef.current.push(strokesRef.current);
    futureRef.current = [];
    setVisibleStrokes(next, true);
    setHistoryRevision((revision) => revision + 1);
  }, [setVisibleStrokes]);
  commitRef.current = commit;

  useEffect(() => {
    const session: DrawingSurfaceSession = {
      element: messageElement,
      getSnapshot: () => ({
        strokes: strokesRef.current,
        tool: toolRef.current,
        penColor: penColorRef.current,
        sizes: sizesRef.current,
      }),
      commit: (next) => commitRef.current(next),
    };
    return surface.register(documentId, session);
  }, [documentId, messageElement, surface]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditing(false);
    surface.deactivate(documentId);
    pastRef.current = [];
    futureRef.current = [];
    setHistoryRevision((revision) => revision + 1);

    if (!identity) {
      setVisibleStrokes([]);
      setLoading(false);
      return () => { cancelled = true; };
    }

    void loadAnnotation(identity)
      .then((loaded) => {
        if (cancelled) return;
        const loadedStrokes = loaded.document ? migrateAnswerStrokes(loaded.document, messageElement) : [];
        setVisibleStrokes(loadedStrokes);
        if (loaded.document && loaded.document.coordinateSpace !== "page") schedulePersist(loadedStrokes);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[InkOrbit] 读取批注失败", error);
          setVisibleStrokes([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [documentId, identity?.conversationId, identity?.messageId, identity?.contentHash]);

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
    if (strokesRef.current.length > 0) commit([]);
  }, [commit]);

  useImperativeHandle(ref, () => ({
    activate(nextTool = "pen") {
      if (streaming || loading || !identityRef.current) return;
      toolRef.current = nextTool;
      setToolState(nextTool);
      setEditing(true);
      surface.activate(documentId);
    },
    setTool(nextTool, settings) {
      toolRef.current = nextTool;
      setToolState(nextTool);
      if (settings?.color && nextTool === "pen") {
        penColorRef.current = settings.color;
        setPenColorState(settings.color);
      }
      if (settings?.size !== undefined) {
        const nextSizes = { ...sizesRef.current, [nextTool]: settings.size };
        sizesRef.current = nextSizes;
        setSizesState(nextSizes);
      }
      surface.refresh(documentId);
    },
    undo,
    redo,
    clear,
    finish() {
      setEditing(false);
      surface.deactivate(documentId);
      flushPersist();
    },
    flush() {
      flushPersist();
    },
  }), [clear, documentId, flushPersist, loading, redo, streaming, surface, undo]);

  useEffect(() => {
    onStateChange({
      editing,
      tool,
      penColor,
      sizes,
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
      strokeCount: strokes.length,
      historyRevision,
      ready: !loading && Boolean(identity),
      streaming,
    });
  }, [editing, historyRevision, identity, loading, onStateChange, penColor, sizes, streaming, strokes.length, tool]);

  useEffect(() => () => flushPersist(), [flushPersist]);

  return null;
});
