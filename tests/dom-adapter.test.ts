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

  it("falls back to a deterministic answer index", () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">one</div>
      <div data-message-author-role="assistant">two</div>
    `;
    const answers = findAssistantMessages();
    expect(getMessageId(answers[1], answers)).toBe("assistant-2");
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
