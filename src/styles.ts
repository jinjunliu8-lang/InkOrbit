export const widgetStyles = `
  :host {
    color-scheme: light dark;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; }

  .paintgpt-floating-root {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 1;
  }

  .paintgpt-main-ball,
  .paintgpt-orbit-button {
    position: fixed;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, .72);
    color: #253047;
    background: rgba(255, 255, 255, .9);
    box-shadow: 0 7px 24px rgba(15, 23, 42, .2), inset 0 0 0 1px rgba(30, 41, 59, .06);
    backdrop-filter: blur(14px) saturate(1.25);
    -webkit-backdrop-filter: blur(14px) saturate(1.25);
    cursor: pointer;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .paintgpt-main-ball {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    opacity: .84;
    z-index: 4;
    touch-action: none;
    transition: left 180ms cubic-bezier(.2,.8,.2,1), opacity 140ms ease, transform 140ms ease, background 140ms ease;
  }
  .paintgpt-main-ball:hover,
  .paintgpt-main-ball:focus-visible,
  .paintgpt-main-ball.is-open { opacity: 1; transform: scale(1.04); }
  .paintgpt-main-ball.is-annotating {
    color: white;
    background: rgba(37, 99, 235, .94);
    border-color: rgba(255, 255, 255, .86);
  }
  .paintgpt-main-ball svg { width: 25px; height: 25px; pointer-events: none; }

  .paintgpt-active-dot {
    position: absolute;
    right: 2px;
    top: 2px;
    width: 10px;
    height: 10px;
    border: 2px solid white;
    border-radius: 50%;
    background: #22c55e;
    pointer-events: none;
  }

  .paintgpt-orbit-button {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    z-index: 3;
    animation: paintgpt-pop 150ms cubic-bezier(.2,.8,.2,1) both;
  }
  .paintgpt-secondary-button { z-index: 2; background: rgba(248, 250, 252, .94); }
  .paintgpt-orbit-button:hover,
  .paintgpt-orbit-button:focus-visible,
  .paintgpt-orbit-button.is-active {
    color: #1557b0;
    background: #e7f0ff;
    transform: scale(1.08);
  }
  .paintgpt-orbit-button.is-done { color: white; background: #202123; }
  .paintgpt-orbit-button.is-clear { color: #dc2626; background: rgba(254, 242, 242, .96); }
  .paintgpt-orbit-button.is-clear:hover,
  .paintgpt-orbit-button.is-clear:focus-visible { color: white; background: #dc2626; }
  .paintgpt-orbit-button:disabled { opacity: .36; cursor: default; transform: none; }
  .paintgpt-orbit-button svg { width: 20px; height: 20px; pointer-events: none; }

  .paintgpt-color-dot {
    width: 23px;
    height: 23px;
    border-radius: 50%;
    background: var(--paintgpt-color);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .2);
    pointer-events: none;
  }
  .paintgpt-size-dot {
    min-width: 6px;
    min-height: 6px;
    border-radius: 50%;
    background: currentColor;
    pointer-events: none;
  }
  .paintgpt-highlighter-mark {
    display: block;
    width: 25px;
    min-height: 5px;
    max-height: 11px;
    border-radius: 3px;
    background: rgba(250, 204, 21, .72);
    transform: rotate(-18deg);
    pointer-events: none;
  }
  .paintgpt-eraser-size { font-size: 12px; font-weight: 650; pointer-events: none; }

  .paintgpt-toast {
    position: fixed;
    z-index: 5;
    width: max-content;
    max-width: min(280px, calc(100vw - 24px));
    padding: 8px 12px;
    border: 1px solid rgba(127, 127, 127, .2);
    border-radius: 10px;
    color: #303030;
    background: rgba(255, 255, 255, .96);
    box-shadow: 0 8px 28px rgba(0, 0, 0, .14);
    font-size: 13px;
    line-height: 1.35;
    pointer-events: none;
    animation: paintgpt-pop 150ms ease-out both;
  }

  @keyframes paintgpt-pop {
    from { opacity: 0; transform: scale(.72); }
    to { opacity: 1; transform: scale(1); }
  }

  @media (prefers-color-scheme: dark) {
    .paintgpt-main-ball,
    .paintgpt-orbit-button,
    .paintgpt-toast {
      color: #ececf1;
      background: rgba(38, 40, 45, .93);
      border-color: rgba(255, 255, 255, .16);
    }
    .paintgpt-main-ball.is-annotating { background: rgba(37, 99, 235, .95); }
    .paintgpt-secondary-button { background: rgba(49, 51, 56, .95); }
    .paintgpt-orbit-button.is-active { background: #243b5a; color: #9ec5ff; }
    .paintgpt-orbit-button.is-done { background: #f3f4f6; color: #202123; }
    .paintgpt-orbit-button.is-clear { background: rgba(69, 10, 10, .94); color: #fca5a5; }
    .paintgpt-orbit-button.is-clear:hover,
    .paintgpt-orbit-button.is-clear:focus-visible { background: #b91c1c; color: white; }
  }

  @media (prefers-reduced-motion: reduce) {
    .paintgpt-main-ball { transition: none; }
    .paintgpt-orbit-button, .paintgpt-toast { animation: none; }
  }
`;
