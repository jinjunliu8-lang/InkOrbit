import { createRoot, type Root } from "react-dom/client";
import { AnnotationWidget } from "./AnnotationWidget";
import { FloatingController, type FloatingTarget } from "./FloatingController";
import {
  createAnswerIdentity,
  findAssistantMessages,
  getAnswerText,
  isGeneratingGlobally,
} from "./dom-adapter";
import { widgetStyles } from "./styles";
import type {
  AnnotationController,
  AnnotationWidgetState,
  AnswerIdentity,
} from "./types";

interface MountedAnswer {
  key: string;
  host: HTMLDivElement;
  root: Root;
  originalPosition: string;
  lastText: string;
  lastChangedAt: number;
  hashingText: string | null;
  identityText: string | null;
  identity: AnswerIdentity | null;
  controller: AnnotationController | null;
  controllerState: AnnotationWidgetState;
  setController(controller: AnnotationController | null): void;
  onStateChange(state: AnnotationWidgetState): void;
}

const mounted = new Map<HTMLElement, MountedAnswer>();
let scanTimer: number | null = null;
let answerSequence = 0;
let floatingRenderPending = false;

const floatingHost = document.createElement("div");
floatingHost.dataset.paintgptFloatingHost = "true";
floatingHost.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
const floatingShadow = floatingHost.attachShadow({ mode: "open" });
const floatingStyle = document.createElement("style");
floatingStyle.textContent = widgetStyles;
const floatingReactRoot = document.createElement("div");
floatingReactRoot.style.cssText = "position:fixed;inset:0;pointer-events:none;";
floatingShadow.append(floatingStyle, floatingReactRoot);
document.documentElement.appendChild(floatingHost);
const floatingRoot = createRoot(floatingReactRoot);

function snapshotTargets(): FloatingTarget[] {
  return Array.from(mounted, ([element, record]) => ({
    key: record.key,
    element,
    controller: record.controller,
    state: record.controllerState,
  }));
}

function scheduleFloatingRender() {
  if (floatingRenderPending) return;
  floatingRenderPending = true;
  queueMicrotask(() => {
    floatingRenderPending = false;
    floatingRoot.render(<FloatingController targets={snapshotTargets()} />);
  });
}

function ensureMounted(message: HTMLElement): MountedAnswer {
  const existing = mounted.get(message);
  if (existing) return existing;

  const originalPosition = message.style.position;
  if (getComputedStyle(message).position === "static") message.style.position = "relative";

  const host = document.createElement("div");
  host.dataset.paintgptAnnotationHost = "true";
  host.style.cssText = "position:absolute;inset:0;z-index:20;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = widgetStyles;
  const reactRoot = document.createElement("div");
  reactRoot.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  shadow.append(style, reactRoot);
  message.appendChild(host);

  let record: MountedAnswer;
  record = {
    key: `paintgpt-answer-${++answerSequence}`,
    host,
    root: createRoot(reactRoot),
    originalPosition,
    lastText: "",
    lastChangedAt: Date.now(),
    hashingText: null,
    identityText: null,
    identity: null,
    controller: null,
    controllerState: {
      editing: false,
      tool: "pen",
      penColor: "#1f2937",
      sizes: { pen: 3, highlighter: 18, eraser: 24 },
      canUndo: false,
      canRedo: false,
      strokeCount: 0,
      ready: false,
      streaming: false,
    },
    setController(controller: AnnotationController | null) {
      if (record.controller === controller) return;
      record.controller = controller;
      scheduleFloatingRender();
    },
    onStateChange(state: AnnotationWidgetState) {
      record.controllerState = state;
      scheduleFloatingRender();
    },
  };
  mounted.set(message, record);
  scheduleFloatingRender();
  return record;
}

function renderRecord(message: HTMLElement, record: MountedAnswer, streaming: boolean) {
  record.root.render(
    <AnnotationWidget
      ref={record.setController}
      messageElement={message}
      identity={record.identity}
      streaming={streaming}
      onStateChange={record.onStateChange}
    />,
  );
}

function scheduleScan(delay = 100) {
  if (scanTimer !== null) window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    scan();
  }, delay);
}

function scan() {
  const messages = findAssistantMessages();
  const current = new Set(messages);
  const globallyGenerating = isGeneratingGlobally();
  const now = Date.now();

  messages.forEach((message, index) => {
    const record = ensureMounted(message);
    const text = getAnswerText(message);
    if (record.lastText !== text) {
      record.lastText = text;
      record.lastChangedAt = now;
      record.identity = null;
      record.identityText = null;
      scheduleScan(1250);
    }

    const isLast = index === messages.length - 1;
    const streaming = isLast && (globallyGenerating || now - record.lastChangedAt < 1100);
    if (record.controllerState.streaming !== streaming) {
      record.controllerState = { ...record.controllerState, streaming };
      scheduleFloatingRender();
    }
    renderRecord(message, record, streaming);

    if (!streaming && text && record.identityText !== text && record.hashingText !== text) {
      record.hashingText = text;
      void createAnswerIdentity(message, messages).then((identity) => {
        record.hashingText = null;
        if (!message.isConnected || getAnswerText(message) !== text) return;
        record.identity = identity;
        record.identityText = text;
        renderRecord(message, record, false);
      });
    }
  });

  for (const [message, record] of mounted) {
    if (message.isConnected && current.has(message)) continue;
    record.root.unmount();
    record.host.remove();
    if (message.isConnected) message.style.position = record.originalPosition;
    mounted.delete(message);
    scheduleFloatingRender();
  }
}

const observer = new MutationObserver(() => scheduleScan());
observer.observe(document.documentElement, {
  childList: true,
  characterData: true,
  subtree: true,
});

window.setInterval(scan, 1500);
scan();
