import type { CanvasSize, Stroke } from "./types";

function pressureWidth(stroke: Stroke, pressure: number) {
  if (stroke.tool === "highlighter") return stroke.baseWidth;
  return stroke.baseWidth * (0.35 + Math.max(0, Math.min(1, pressure)) * 0.95);
}

export function renderStrokes(
  context: CanvasRenderingContext2D,
  strokes: Stroke[],
  baseSize: CanvasSize,
  displaySize: CanvasSize,
  devicePixelRatio: number,
) {
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, displaySize.width, displaySize.height);
  if (baseSize.width <= 0 || baseSize.height <= 0) return;

  const scaleX = displaySize.width / baseSize.width;
  const scaleY = displaySize.height / baseSize.height;
  const widthScale = (scaleX + scaleY) / 2;

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    context.save();
    context.globalAlpha = stroke.opacity;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      const radius = (pressureWidth(stroke, point.pressure) * widthScale) / 2;
      context.beginPath();
      context.arc(point.x * scaleX, point.y * scaleY, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
      continue;
    }

    for (let index = 1; index < stroke.points.length; index += 1) {
      const start = stroke.points[index - 1];
      const end = stroke.points[index];
      context.lineWidth =
        ((pressureWidth(stroke, start.pressure) + pressureWidth(stroke, end.pressure)) / 2) *
        widthScale;
      context.beginPath();
      context.moveTo(start.x * scaleX, start.y * scaleY);
      context.lineTo(end.x * scaleX, end.y * scaleY);
      context.stroke();
    }
    context.restore();
  }
}
