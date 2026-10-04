import { hashText, normalizeAnswerText } from "./hash";
import type { AnswerIdentity } from "./types";

// ChatGPT has used both shapes. Keep the legacy selector so existing and
// gradually rolled-out layouts continue to work.
const ASSISTANT_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-turn="assistant"]',
  'h4[data-conversation-role="assistant"]',
].join(",");
const STOP_BUTTON_SELECTOR = [
  '[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="停止生成"]',
].join(",");

export function findAssistantMessages(root: ParentNode = document): HTMLElement[] {
  const candidates = new Set(
    Array.from(root.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR))
      .map((element) => element.matches('h4[data-conversation-role="assistant"]')
        ? element.parentElement
        : element)
      .filter((element): element is HTMLElement => element instanceof HTMLElement),
  );
  // ChatGPT may expose both the turn wrapper and the answer node. Keep the
  // innermost answer so selecting it never includes the user's prompt.
  for (const element of candidates) {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      candidates.delete(ancestor);
    }
  }
  return Array.from(candidates);
}

export function getAnswerText(element: HTMLElement): string {
  // The newer search-unit wrapper includes an accessible role heading before
  // the actual answer. Hash only its answer child to preserve stable content.
  const roleHeading = element.querySelector<HTMLElement>(':scope > h4[data-conversation-role="assistant"]');
  const answer = roleHeading?.nextElementSibling instanceof HTMLElement
    ? roleHeading.nextElementSibling
    : element;
  // In real browsers innerText already excludes our display:none host. Avoid
  // cloning a potentially very large answer during every observer scan.
  if (typeof answer.innerText === "string") return normalizeAnswerText(answer.innerText);

  // jsdom and older DOM implementations may not expose innerText. Keep the
  // clone-based fallback so injected extension text is never hashed.
  const clone = answer.cloneNode(true) as HTMLElement;
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

  const searchUnit = element.closest<HTMLElement>("[data-chatgpt-search-message-ids]") ??
    element.querySelector<HTMLElement>("[data-chatgpt-search-message-ids]");
  const searchMessageId = searchUnit?.dataset.chatgptSearchMessageIds?.trim().split(/\s+/)[0];
  if (searchMessageId) return searchMessageId;

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
  knownText?: string,
): Promise<AnswerIdentity> {
  const text = knownText ?? getAnswerText(element);
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
