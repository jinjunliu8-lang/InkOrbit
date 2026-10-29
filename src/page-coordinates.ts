/** Read the current ancestor chain, not a cached scroll container. ChatGPT
 * can mount answers before overflow exists, and can reparent them later. */
export function pageOrigin(element: HTMLElement) {
  let x = window.scrollX;
  let y = window.scrollY;
  const documentScroller = document.scrollingElement ?? document.documentElement;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    // window.scrollX/Y already includes the document's scrolling element.
    if (parent === documentScroller || parent === document.documentElement) continue;
    x += parent.scrollLeft;
    y += parent.scrollTop;
  }
  return { x, y };
}

export function findPrimaryScroller(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.scrollingElement || parent === document.documentElement) return null;
    // Recognize an overflow container even before its content becomes long.
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}
