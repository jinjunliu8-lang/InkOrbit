import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findAssistantMessages,
  createAnswerIdentity,
  getAnswerText,
  getConversationId,
  getMessageId,
  isGeneratingGlobally,
} from "../src/dom-adapter";

describe("ChatGPT DOM adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("finds assistant messages and ignores user messages", () => {
    document.body.innerHTML = `
      <div data-message-author-role="user">question</div>
      <div data-message-author-role="assistant" data-message-id="answer-1">answer</div>
    `;
    const answers = findAssistantMessages();
    expect(answers).toHaveLength(1);
    expect(getAnswerText(answers[0])).toBe("answer");
    expect(getMessageId(answers[0], answers)).toBe("answer-1");
  });

  it("supports the current data-turn based ChatGPT layout", () => {
    document.body.innerHTML = `
      <section data-turn="user" data-turn-id="turn-user">question</section>
      <section data-turn="assistant" data-turn-id="turn-assistant" data-testid="conversation-turn-2">
        <h4>ChatGPT 说：</h4>
        <div data-message-author-role="assistant">current answer</div>
      </section>
    `;
    const answers = findAssistantMessages();
    expect(answers).toHaveLength(1);
    expect(answers[0].dataset.messageAuthorRole).toBe("assistant");
    expect(getAnswerText(answers[0])).toContain("current answer");
    expect(getMessageId(answers[0], answers)).toBe("turn-assistant");
  });

  it("recognizes search-unit answers in the newer ChatGPT layout", () => {
    document.body.innerHTML = `
      <div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant"
        data-chatgpt-search-message-ids="answer-new answer-new">
        <h4 data-conversation-role="assistant">ChatGPT 说：</h4>
        <div>New answer content</div>
      </div>
      <div data-chatgpt-search-unit-key="fallback-turn-1:1:user">
        <h4 data-conversation-role="user">你说：</h4>
        <div>User prompt</div>
      </div>
    `;
    const answers = findAssistantMessages();
    expect(answers).toHaveLength(1);
    expect(getAnswerText(answers[0])).toBe("New answer content");
    expect(getMessageId(answers[0], answers)).toBe("answer-new");
  });

  it("falls back to a deterministic answer index", () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">one</div>
      <div data-message-author-role="assistant">two</div>
    `;
    const answers = findAssistantMessages();
    expect(getMessageId(answers[1], answers)).toBe("assistant-2");
  });

  it("supports role headings of different levels and direct role containers", () => {
    document.body.innerHTML = `
      <section data-chatgpt-search-message-ids="heading-answer">
        <h5 data-conversation-role="assistant">ChatGPT 说：</h5><div>Heading answer</div>
      </section>
      <div data-conversation-role="assistant" data-message-id="container-answer">Container answer</div>
      <div data-conversation-role="user">Prompt</div>
      <button aria-label="停止">停止</button>
    `;
    const answers = findAssistantMessages();
    expect(answers.map(getAnswerText)).toEqual(["Heading answer", "Container answer"]);
    expect(answers.map(answer => getMessageId(answer, answers))).toEqual(["heading-answer", "container-answer"]);
    expect(isGeneratingGlobally()).toBe(true);
  });

  it("does not include injected extension UI in the answer text", () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">
        Original answer
        <div data-paintgpt-annotation-host="true">批注工具</div>
      </div>
    `;
    expect(getAnswerText(findAssistantMessages()[0])).toBe("Original answer");
  });

  it("uses the browser innerText fast path without cloning long answers", () => {
    const answer = document.createElement("div");
    Object.defineProperty(answer, "innerText", { value: "  Fast   answer  ", configurable: true });
    const clone = vi.spyOn(answer, "cloneNode");
    expect(getAnswerText(answer)).toBe("Fast answer");
    expect(clone).not.toHaveBeenCalled();
  });

  it("reuses already-read answer text when creating an identity", async () => {
    const answer = document.createElement("div");
    answer.dataset.messageId = "answer-known-text";
    Object.defineProperty(answer, "innerText", {
      get: () => { throw new Error("answer text should not be read twice"); },
      configurable: true,
    });

    const identity = await createAnswerIdentity(answer, [answer], "Known answer");
    expect(identity.messageId).toBe("answer-known-text");
    expect(identity.contentHash).toHaveLength(64);
  });

  it("extracts conversation ids and detects generation controls", () => {
    expect(getConversationId({ pathname: "/c/conversation-123" } as Location)).toBe("conversation-123");
    document.body.innerHTML = '<button data-testid="stop-button">stop</button>';
    expect(isGeneratingGlobally()).toBe(true);
  });
});
