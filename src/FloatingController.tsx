import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  FLOATING_DRAG_THRESHOLD,
  clampFloatingPosition,
  computeRadialPositions,
  hasExceededDragThreshold,
  restoreFloatingPosition,
  selectBestVisibleAnswer,
  snapFloatingPosition,
  type FloatingPosition,
  type StoredFloatingPosition,
  type ViewportSize,
} from "./floating-geometry";
import type {
  ActiveTool,
  AnnotationController,
  AnnotationWidgetState,
  ToolSettings,
} from "./types";

const POSITION_STORAGE_KEY = "paintgpt-floating-position-v1";
const PEN_COLORS = ["#1f2937", "#dc2626", "#2563eb"];

export interface FloatingTarget {
  key: string;
  element: HTMLElement;
  controller: AnnotationController | null;
  state: AnnotationWidgetState;
}

interface FloatingControllerProps {
  targets: FloatingTarget[];
}

interface MenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  active?: boolean;
  action(): void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: FloatingPosition;
  moved: boolean;
}

function icon(path: string) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const icons = {
  pen: icon("m4 20 4.4-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.4 16 4 20Zm10.7-13.3 2.6 2.6"),
  highlighter: icon("m5 15 7-7 4 4-7 7H5v-4Zm9-9 4 4 1.5-1.5a2.1 2.1 0 0 0-3-3L14 6ZM4 21h16"),
  eraser: icon("m7.5 18.5-3-3a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8l-7 7h-4.8ZM11 19h9"),
  undo: icon("M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"),
  redo: icon("m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6"),
  done: icon("m5 12 4 4L19 6"),
  trash: icon("M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"),
};

function viewportSize(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

function readStoredPosition(): StoredFloatingPosition | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) || "null") as Partial<StoredFloatingPosition> | null;
    if (!parsed || (parsed.side !== "left" && parsed.side !== "right") || typeof parsed.yRatio !== "number") {
      return null;
    }
    return { side: parsed.side, yRatio: parsed.yRatio };
  } catch {
    return null;
  }
}

function writeStoredPosition(position: StoredFloatingPosition) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // The control still works when localStorage is blocked; only position memory is lost.
  }
}

function flashAnswer(element: HTMLElement) {
  element.animate?.(
    [
      { outline: "0 solid rgba(37, 99, 235, 0)", outlineOffset: "2px" },
      { outline: "3px solid rgba(37, 99, 235, .78)", outlineOffset: "4px" },
      { outline: "0 solid rgba(37, 99, 235, 0)", outlineOffset: "7px" },
    ],
    { duration: 850, easing: "ease-out" },
  );
}

export function FloatingController({ targets }: FloatingControllerProps) {
  const [viewport, setViewport] = useState(viewportSize);
  const [position, setPosition] = useState(() =>
    restoreFloatingPosition(readStoredPosition(), viewportSize()),
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [secondaryTool, setSecondaryTool] = useState<ActiveTool | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const activeTarget = targets.find((target) => target.key === activeKey) ?? null;
  const currentTool = activeTarget?.state.tool ?? "pen";
  const side = position.x + 26 < viewport.width / 2 ? "left" : "right";

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 1800);
  }, []);

  const finish = useCallback(() => {
    activeTarget?.controller?.finish();
    setActiveKey(null);
    setMenuOpen(false);
    setSecondaryTool(null);
  }, [activeTarget]);

  useEffect(() => {
    const onResize = () => {
      const nextViewport = viewportSize();
      setViewport(nextViewport);
      setPosition(restoreFloatingPosition(readStoredPosition(), nextViewport));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (activeKey && !targets.some((target) => target.key === activeKey)) {
      setActiveKey(null);
      setMenuOpen(false);
      setSecondaryTool(null);
    }
  }, [activeKey, targets]);

  useEffect(() => {
    if (activeTarget && (!activeTarget.state.ready || activeTarget.state.streaming)) finish();
  }, [activeTarget?.state.ready, activeTarget?.state.streaming, finish]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const isControl = event.composedPath().some(
        (node) => node instanceof HTMLElement && node.dataset.paintgptControl === "true",
      );
      if (!isControl) {
        setMenuOpen(false);
        setSecondaryTool(null);
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [menuOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (secondaryTool) setSecondaryTool(null);
      else if (menuOpen) setMenuOpen(false);
      else if (activeKey) finish();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeKey, finish, menuOpen, secondaryTool]);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const activateCurrentAnswer = useCallback(() => {
    const selected = selectBestVisibleAnswer(
      targets.map((target) => ({
        ...target,
        eligible: Boolean(target.controller && target.state.ready && !target.state.streaming),
      })),
      viewport,
    );
    if (!selected?.controller) {
      showToast(targets.some((target) => target.state.streaming) ? "回答生成完成后即可批注" : "屏幕上没有可批注的回答");
      return;
    }
    selected.controller.activate("pen");
    setActiveKey(selected.key);
    setMenuOpen(true);
    setSecondaryTool(null);
    flashAnswer(selected.element);
  }, [showToast, targets, viewport]);

  const toggleMain = useCallback(() => {
    if (!activeTarget) {
      activateCurrentAnswer();
      return;
    }
    setMenuOpen((open) => !open);
    setSecondaryTool(null);
  }, [activateCurrentAnswer, activeTarget]);

  const chooseTool = (tool: ActiveTool) => {
    if (!activeTarget?.controller) return;
    if (currentTool === tool) {
      setSecondaryTool((current) => (current === tool ? null : tool));
      return;
    }
    activeTarget.controller.setTool(tool);
    setSecondaryTool(null);
    setMenuOpen(false);
  };

  const setToolSettings = (tool: ActiveTool, settings: ToolSettings) => {
    activeTarget?.controller?.setTool(tool, settings);
  };

  const primaryItems = useMemo<MenuItem[]>(
    () => [
      { id: "pen", label: "钢笔；再次点击设置颜色和粗细", icon: icons.pen, active: currentTool === "pen", action: () => chooseTool("pen") },
      { id: "highlighter", label: "荧光笔；再次点击设置粗细", icon: icons.highlighter, active: currentTool === "highlighter", action: () => chooseTool("highlighter") },
      { id: "eraser", label: "橡皮；再次点击设置大小或清空", icon: icons.eraser, active: currentTool === "eraser", action: () => chooseTool("eraser") },
      { id: "undo", label: "撤销", icon: icons.undo, disabled: !activeTarget?.state.canUndo, action: () => activeTarget?.controller?.undo() },
      { id: "redo", label: "重做", icon: icons.redo, disabled: !activeTarget?.state.canRedo, action: () => activeTarget?.controller?.redo() },
      { id: "done", label: "完成批注", icon: icons.done, action: finish },
    ],
    [activeTarget, currentTool, finish],
  );

  const secondaryItems = useMemo<MenuItem[]>(() => {
    if (!secondaryTool || !activeTarget) return [];
    if (secondaryTool === "pen") {
      const colors = PEN_COLORS.map((color, index) => ({
        id: `color-${color}`,
        label: ["黑色", "红色", "蓝色"][index],
        icon: <span className="paintgpt-color-dot" style={{ "--paintgpt-color": color } as CSSProperties} />,
        active: activeTarget.state.penColor === color,
        action: () => setToolSettings("pen", { color }),
      }));
      const sizes = [2, 4, 7].map((size, index) => ({
        id: `pen-size-${size}`,
        label: `钢笔${["细", "中", "粗"][index]}`,
        icon: <span className="paintgpt-size-dot" style={{ width: size + 4, height: size + 4 }} />,
        active: activeTarget.state.sizes.pen === size,
        action: () => setToolSettings("pen", { size }),
      }));
      return [...colors, ...sizes];
    }
    if (secondaryTool === "highlighter") {
      return [12, 18, 28].map((size, index) => ({
        id: `highlighter-size-${size}`,
        label: `荧光笔${["细", "中", "粗"][index]}`,
        icon: <span className="paintgpt-highlighter-mark" style={{ height: Math.max(5, size / 3) }} />,
        active: activeTarget.state.sizes.highlighter === size,
        action: () => setToolSettings("highlighter", { size }),
      }));
    }
    const eraserSizes: MenuItem[] = [16, 24, 40].map((size, index) => ({
      id: `eraser-size-${size}`,
      label: `橡皮${["小", "中", "大"][index]}`,
      icon: <span className="paintgpt-eraser-size">{["小", "中", "大"][index]}</span>,
      active: activeTarget.state.sizes.eraser === size,
      action: () => setToolSettings("eraser", { size }),
    }));
    return [
      ...eraserSizes,
      {
        id: "clear",
        label: "清空全部笔迹（可撤销）",
        icon: icons.trash,
        disabled: activeTarget.state.strokeCount === 0,
        action: () => {
          activeTarget.controller?.clear();
          setSecondaryTool(null);
        },
      },
    ];
  }, [activeTarget, secondaryTool]);

  const primaryPositions = computeRadialPositions(position, side, primaryItems.length, viewport);
  const secondaryPositions = computeRadialPositions(position, side, secondaryItems.length, viewport, 154);

  const onMainPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: position,
      moved: false,
    };
  };

  const onMainPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (
      !drag.moved &&
      hasExceededDragThreshold(
        { x: drag.startX, y: drag.startY },
        { x: event.clientX, y: event.clientY },
        FLOATING_DRAG_THRESHOLD,
      )
    ) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    setSecondaryTool(null);
    setPosition(clampFloatingPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY }, viewport));
  };

  const onMainPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      toggleMain();
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const snapped = snapFloatingPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY }, viewport);
    setPosition(snapped.position);
    writeStoredPosition(snapped.stored);
  };

  const onMainPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A cancelled gesture is never a click. Snap the last visible position so
    // the control remains usable after OS gestures or pen proximity changes.
    const snapped = snapFloatingPosition(position, viewport);
    setPosition(snapped.position);
    writeStoredPosition(snapped.stored);
  };

  if (targets.length === 0) return null;

  return (
    <div className="paintgpt-floating-root" aria-live="polite">
      {menuOpen && primaryItems.map((item, index) => (
        <button
          key={item.id}
          data-paintgpt-control="true"
          className={`paintgpt-orbit-button${item.active ? " is-active" : ""}${item.id === "done" ? " is-done" : ""}`}
          style={{ left: primaryPositions[index].left, top: primaryPositions[index].top }}
          title={item.label}
          aria-label={item.label}
          aria-pressed={item.active}
          disabled={item.disabled}
          onClick={item.action}
        >
          {item.icon}
        </button>
      ))}

      {menuOpen && secondaryTool && secondaryItems.map((item, index) => (
        <button
          key={item.id}
          data-paintgpt-control="true"
          className={`paintgpt-orbit-button paintgpt-secondary-button${item.active ? " is-active" : ""}`}
          style={{ left: secondaryPositions[index].left, top: secondaryPositions[index].top }}
          title={item.label}
          aria-label={item.label}
          aria-pressed={item.active}
          disabled={item.disabled}
          onClick={item.action}
        >
          {item.icon}
        </button>
      ))}

      <button
        data-paintgpt-control="true"
        className={`paintgpt-main-ball${activeTarget ? " is-annotating" : ""}${menuOpen ? " is-open" : ""}`}
        style={{ left: position.x, top: position.y }}
        title={activeTarget ? "打开批注工具；拖动可移动" : "批注当前回答；拖动可移动"}
        aria-label={activeTarget ? "打开批注工具" : "批注当前回答"}
        aria-expanded={menuOpen}
        onPointerDown={onMainPointerDown}
        onPointerMove={onMainPointerMove}
        onPointerUp={onMainPointerUp}
        onPointerCancel={onMainPointerCancel}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleMain();
          }
        }}
      >
        {icons[currentTool]}
        {activeTarget && <span className="paintgpt-active-dot" />}
      </button>

      {toast && (
        <div className="paintgpt-toast" style={{ left: side === "left" ? position.x : undefined, right: side === "right" ? viewport.width - position.x - 52 : undefined, top: Math.max(12, position.y - 48) }}>
          {toast}
        </div>
      )}
    </div>
  );
}
