export type DrawingTool = "pen" | "highlighter";
export type ActiveTool = DrawingTool | "eraser";

export interface ToolSizes {
  pen: number;
  highlighter: number;
  eraser: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

export interface Stroke {
  id: string;
  tool: DrawingTool;
  color: string;
  baseWidth: number;
  opacity: number;
  points: StrokePoint[];
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface AnnotationDocument {
  version: 1;
  conversationId: string;
  messageId: string;
  contentHash: string;
  canvas: CanvasSize;
  strokes: Stroke[];
  updatedAt: number;
}

export interface AnswerIdentity {
  conversationId: string;
  messageId: string;
  contentHash: string;
}

export interface LoadedAnnotation {
  document: AnnotationDocument | null;
  contentMismatch: boolean;
}

export interface AnnotationWidgetState {
  editing: boolean;
  tool: ActiveTool;
  penColor: string;
  sizes: ToolSizes;
  canUndo: boolean;
  canRedo: boolean;
  strokeCount: number;
  ready: boolean;
  streaming: boolean;
}

export interface ToolSettings {
  color?: string;
  size?: number;
}

export interface AnnotationController {
  activate(tool?: ActiveTool): void;
  setTool(tool: ActiveTool, settings?: ToolSettings): void;
  undo(): void;
  redo(): void;
  clear(): void;
  finish(): void;
}
