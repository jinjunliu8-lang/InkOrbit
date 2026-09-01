export const FLOATING_BALL_SIZE = 52;
export const FLOATING_BUTTON_SIZE = 42;
export const FLOATING_MARGIN = 12;
export const FLOATING_DRAG_THRESHOLD = 6;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface FloatingPosition {
  x: number;
  y: number;
}

export type FloatingSide = "left" | "right";

export interface StoredFloatingPosition {
  side: FloatingSide;
  yRatio: number;
}

export interface RadialPosition {
  left: number;
  top: number;
}

export interface SelectableAnswer {
  element: HTMLElement;
  eligible: boolean;
}

export function hasExceededDragThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = FLOATING_DRAG_THRESHOLD,
) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function defaultFloatingPosition(viewport: ViewportSize): FloatingPosition {
  return {
    x: Math.max(FLOATING_MARGIN, viewport.width - FLOATING_BALL_SIZE - FLOATING_MARGIN),
    y: clamp(
      viewport.height * 0.58 - FLOATING_BALL_SIZE / 2,
      FLOATING_MARGIN,
      Math.max(FLOATING_MARGIN, viewport.height - FLOATING_BALL_SIZE - FLOATING_MARGIN),
    ),
  };
}

export function restoreFloatingPosition(
  stored: StoredFloatingPosition | null,
  viewport: ViewportSize,
): FloatingPosition {
  if (!stored || !Number.isFinite(stored.yRatio)) return defaultFloatingPosition(viewport);
  const availableHeight = Math.max(0, viewport.height - FLOATING_BALL_SIZE - FLOATING_MARGIN * 2);
  return {
    x:
      stored.side === "left"
        ? FLOATING_MARGIN
        : Math.max(FLOATING_MARGIN, viewport.width - FLOATING_BALL_SIZE - FLOATING_MARGIN),
    y: FLOATING_MARGIN + clamp(stored.yRatio, 0, 1) * availableHeight,
  };
}

export function clampFloatingPosition(
  position: FloatingPosition,
  viewport: ViewportSize,
): FloatingPosition {
  return {
    x: clamp(
      position.x,
      FLOATING_MARGIN,
      Math.max(FLOATING_MARGIN, viewport.width - FLOATING_BALL_SIZE - FLOATING_MARGIN),
    ),
    y: clamp(
      position.y,
      FLOATING_MARGIN,
      Math.max(FLOATING_MARGIN, viewport.height - FLOATING_BALL_SIZE - FLOATING_MARGIN),
    ),
  };
}

export function snapFloatingPosition(
  position: FloatingPosition,
  viewport: ViewportSize,
): { position: FloatingPosition; stored: StoredFloatingPosition } {
  const clamped = clampFloatingPosition(position, viewport);
  const side: FloatingSide = clamped.x + FLOATING_BALL_SIZE / 2 < viewport.width / 2 ? "left" : "right";
  const availableHeight = Math.max(1, viewport.height - FLOATING_BALL_SIZE - FLOATING_MARGIN * 2);
  return {
    position: {
      x:
        side === "left"
          ? FLOATING_MARGIN
          : Math.max(FLOATING_MARGIN, viewport.width - FLOATING_BALL_SIZE - FLOATING_MARGIN),
      y: clamped.y,
    },
    stored: {
      side,
      yRatio: clamp((clamped.y - FLOATING_MARGIN) / availableHeight, 0, 1),
    },
  };
}

function menuAngles(count: number, centerY: number, viewportHeight: number, radius: number) {
  if (count <= 1) return [0];
  let start = -70;
  let end = 70;
  if (centerY < radius + FLOATING_BUTTON_SIZE / 2 + FLOATING_MARGIN) {
    start = 10;
    end = 85;
  } else if (centerY > viewportHeight - radius - FLOATING_BUTTON_SIZE / 2 - FLOATING_MARGIN) {
    start = -85;
    end = -10;
  }
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

export function computeRadialPositions(
  main: FloatingPosition,
  side: FloatingSide,
  count: number,
  viewport: ViewportSize,
  radius = 98,
): RadialPosition[] {
  const centerX = main.x + FLOATING_BALL_SIZE / 2;
  const centerY = main.y + FLOATING_BALL_SIZE / 2;
  const direction = side === "left" ? 1 : -1;
  return menuAngles(count, centerY, viewport.height, radius).map((degrees) => {
    const radians = (degrees * Math.PI) / 180;
    return {
      left: clamp(
        centerX + direction * Math.cos(radians) * radius - FLOATING_BUTTON_SIZE / 2,
        FLOATING_MARGIN,
        Math.max(FLOATING_MARGIN, viewport.width - FLOATING_BUTTON_SIZE - FLOATING_MARGIN),
      ),
      top: clamp(
        centerY + Math.sin(radians) * radius - FLOATING_BUTTON_SIZE / 2,
        FLOATING_MARGIN,
        Math.max(FLOATING_MARGIN, viewport.height - FLOATING_BUTTON_SIZE - FLOATING_MARGIN),
      ),
    };
  });
}

export function selectBestVisibleAnswer<T extends SelectableAnswer>(
  answers: T[],
  viewport: ViewportSize,
): T | null {
  const viewportCenterX = viewport.width / 2;
  const viewportCenterY = viewport.height / 2;
  let best: { answer: T; area: number; distance: number } | null = null;

  for (const answer of answers) {
    if (!answer.eligible || !answer.element.isConnected) continue;
    const rect = answer.element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(viewport.width, rect.right) - Math.max(0, rect.left));
    const visibleHeight = Math.max(0, Math.min(viewport.height, rect.bottom) - Math.max(0, rect.top));
    const area = visibleWidth * visibleHeight;
    if (area <= 0) continue;
    const answerCenterX = (Math.max(0, rect.left) + Math.min(viewport.width, rect.right)) / 2;
    const answerCenterY = (Math.max(0, rect.top) + Math.min(viewport.height, rect.bottom)) / 2;
    const distance = Math.hypot(answerCenterX - viewportCenterX, answerCenterY - viewportCenterY);
    if (!best || area > best.area || (area === best.area && distance < best.distance)) {
      best = { answer, area, distance };
    }
  }

  return best?.answer ?? null;
}
