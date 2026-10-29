import { afterEach, describe, expect, it, vi } from "vitest";
import { findPrimaryScroller, pageOrigin } from "../src/page-coordinates";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("coordinates in dynamic ChatGPT layouts", () => {
  it("follows an overflow container that becomes scrollable after the answer mounts", () => {
    const container = document.createElement("div");
    const answer = document.createElement("div");
    document.body.append(container);
    container.append(answer);
    container.style.overflowY = "auto";
    expect(findPrimaryScroller(answer)).toBe(container);
    expect(pageOrigin(answer)).toEqual({ x: 0, y: 0 });
    container.scrollTop = 350;
    expect(pageOrigin(answer)).toEqual({ x: 0, y: 350 });
  });

  it("sums nested horizontal and vertical scroll and responds to reparenting", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    const replacement = document.createElement("div");
    const answer = document.createElement("div");
    document.body.append(outer, replacement);
    outer.append(inner);
    inner.append(answer);
    outer.scrollTop = 200;
    inner.scrollTop = 50;
    inner.scrollLeft = 80;
    expect(pageOrigin(answer)).toEqual({ x: 80, y: 250 });
    replacement.scrollTop = 400;
    replacement.append(answer);
    expect(pageOrigin(answer)).toEqual({ x: 0, y: 400 });
  });

  it("does not count the document scroller twice", () => {
    const answer = document.createElement("div");
    document.body.append(answer);
    vi.stubGlobal("scrollX", 30);
    vi.stubGlobal("scrollY", 250);
    document.documentElement.scrollTop = 250;
    document.documentElement.scrollLeft = 30;
    expect(pageOrigin(answer)).toEqual({ x: 30, y: 250 });
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
  });
});
