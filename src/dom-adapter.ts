import { hashText, normalizeAnswerText } from "./hash";
import type { AnswerIdentity } from "./types";

// ChatGPT has used both shapes. Keep the legacy selector so existing and
// gradually rolled-out layouts continue to work.
const ASSISTANT_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-turn="assistant"]',
].join(",");
const STOP_BUTTON_SELECTOR = [
  '[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="停止生成"]',
].join(",");

export function findAssistantMessages(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR)).filter((element) => {
    // The current layout wraps the old assistant message node in a wider
    // `data-turn` section. Prefer the innermost node so the canvas follows the
    // actual answer column instead of spanning the entire page.
    return element.querySelector(ASSISTANT_SELECTOR) === null;
  });
}

export function getAnswerText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-paintgpt-annotation-host="true"]').forEach((host) => host.remove());
  return normalizeAnswerText(clone.innerText || clone.textContent || "");
}

export function getConversationId(locationLike: Pick<Location, "pathname"> = window.location) {
  const match = locationLike.pathname.match(/\/c\/([^/?#]+)/);
  if (match?.[1]) return match[1];
  return locationLike.pathname.replace(/^\/+|\/+$/g, "") || "new-chat";
}

export function getMessageId(element: HTMLElement, allMessages: HTMLElement[]): string {
  const identified = element.closest<HTMLElement>("[data-message-id]") ??
    element.querySelector<HTMLElement>("[data-message-id]");
  const explicitId = identified?.dataset.messageId;
  if (explicitId) return explicitId;

  const turn = element.closest<HTMLElement>("[data-turn-id]") ??
    element.querySelector<HTMLElement>("[data-turn-id]");
  const turnId = turn?.dataset.turnId;
  if (turnId) return turnId;

  const conversationTurn = element.closest<HTMLElement>('[data-testid^="conversation-turn-"]') ??
    element.querySelector<HTMLElement>('[data-testid^="conversation-turn-"]');
  const conversationTurnId = conversationTurn?.dataset.testid;
  if (conversationTurnId) return conversationTurnId;

  const article = element.closest<HTMLElement>("article");
  const articleId = article?.getAttribute("data-testid") || article?.id;
  if (articleId) return articleId;

  const index = Math.max(0, allMessages.indexOf(element));
  return `assistant-${index + 1}`;
}

export function isGeneratingGlobally(root: ParentNode = document): boolean {
  return root.querySelector(STOP_BUTTON_SELECTOR) !== null;
}

export async function createAnswerIdentity(
  element: HTMLElement,
  allMessages: HTMLElement[],
): Promise<AnswerIdentity> {
  const text = getAnswerText(element);
  return {
    conversationId: getConversationId(),
    messageId: getMessageId(element, allMessages),
    contentHash: await hashText(text),
  };
}

export const chatGptSelectors = {
  assistant: ASSISTANT_SELECTOR,
  stopButton: STOP_BUTTON_SELECTOR,
};
