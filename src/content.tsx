import { createRoot, type Root } from "react-dom/client";
import { AnnotationWidget } from "./AnnotationWidget";
import { FloatingController, type FloatingTarget } from "./FloatingController";
import {
  createAnswerIdentity,
  findAssistantMessages,
  getConversationId,
  getAnswerText,
  isGeneratingGlobally,
} from "./dom-adapter";
import { widgetStyles } from "./styles";
import type {
  AnnotationController,
  AnnotationWidgetState,
  AnswerIdentity,
} from "./types";

declare global {
  interface Window {
    __inkOrbitCleanup?: () => void;
  }
}

// A development reload or extension update can inject a new bundle into an
// existing tab. Dispose a previous 0.3+ instance and remove legacy 0.2 hosts.
window.__inkOrbitCleanup?.();
document
  .querySelectorAll('[data-paintgpt-floating-host="true"], [data-paintgpt-annotation-host="true"]')
  .forEach((host) => host.remove());

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
let lastConversationId = getConversationId();

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
  if (existing) {
    if (!existing.host.isConnected) document.documentElement.appendChild(existing.host);
    return existing;
  }

  const originalPosition = message.style.position;

  const host = document.createElement("div");
  host.dataset.paintgptAnnotationHost = "true";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = widgetStyles;
  const reactRoot = document.createElement("div");
  reactRoot.style.cssText = "position:fixed;inset:0;pointer-events:none;";
  shadow.append(style, reactRoot);
  document.documentElement.appendChild(host);

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
  // Do not let continuous streaming mutations postpone the scan forever.
  if (scanTimer !== null) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    scan();
  }, delay);
}

function scan() {
  if (!floatingHost.isConnected) document.documentElement.appendChild(floatingHost);

  const conversationId = getConversationId();
  if (conversationId !== lastConversationId) {
    lastConversationId = conversationId;
    for (const [, record] of mounted) {
      record.identity = null;
      record.identityText = null;
      record.hashingText = null;
    }
  }

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

const scanInterval = window.setInterval(scan, 1500);

window.__inkOrbitCleanup = () => {
  observer.disconnect();
  if (scanTimer !== null) window.clearTimeout(scanTimer);
  window.clearInterval(scanInterval);
  for (const [message, record] of mounted) {
    record.root.unmount();
    record.host.remove();
    if (message.isConnected) message.style.position = record.originalPosition;
  }
  mounted.clear();
  floatingRoot.unmount();
  floatingHost.remove();
  delete window.__inkOrbitCleanup;
};

scan();
