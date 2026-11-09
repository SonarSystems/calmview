// Waiting, made visible and honest (from Ticklist). Use these only after measuring: most waits can be
// removed (draw from a kept copy, read in parallel, one range read instead of many).
//   • loadingScreen(): for a wait that's certain and long (an API that needs one read per item). A real
//     progress bar (call set() as things arrive, never a fake timer), what's happening, and something
//     to read (pass a quote or tip). Show it at once for a certain wait, after ~1 s for a maybe-wait.
//   • pending(): for a maybe-wait (a page that sometimes asks the network). A slim bar along the top
//     after `delay` ms, so fast paths never flash; stop() it in a finally.
// Both respect reduced motion. Styles are injected once and use the theme's tokens, so they follow
// light and dark mode.
const CSS = `
.ld { max-width: 480px; margin: clamp(24px, 10vh, 96px) auto; padding: 0 16px; text-align: center; }
.ld-title { font-size: 20px; margin: 0 0 14px; }
.ld-meter { display: flex; align-items: center; gap: 12px; }
.ld-bar { position: relative; flex: 1; height: 8px; border-radius: 99px; background: var(--line); overflow: hidden; }
.ld-fill { position: absolute; inset: 0 auto 0 0; width: 4%; border-radius: inherit; background: var(--brand); transition: width .35s cubic-bezier(.2,.8,.2,1); }
.ld-pct { min-width: 3.2em; text-align: right; font-size: 13px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.ld-label { margin: 10px 0 0; color: var(--muted); font-size: 14px; min-height: 1.4em; }
.ld-note { margin: 28px auto 0; padding: 16px 18px; border-radius: 12px; background: var(--soft); border: 1px solid var(--line); font-style: italic; }
.ld-note small { display: block; margin-top: 6px; font-style: normal; color: var(--muted); }
.pending-bar { position: fixed; inset: 0 0 auto 0; height: 3px; z-index: 50; pointer-events: none; overflow: hidden; }
.pending-bar span { position: absolute; top: 0; bottom: 0; width: 40%; background: linear-gradient(90deg, transparent, var(--brand), transparent); animation: pending-slide 1s ease-in-out infinite; }
@keyframes pending-slide { from { left: -40%; } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .pending-bar span { animation: none; left: 0; width: 100%; } .ld-fill { transition: none; } }
`;

let styled = false;
function style(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = CSS;
  document.head.append(s);
}

const el = (tag: string, cls: string, text?: string) => Object.assign(document.createElement(tag), { className: cls, ...(text !== undefined ? { textContent: text } : {}) });

export interface Loader {
  el: HTMLElement;
  /** `done` of `total` finished (never goes backwards); `label` says what's happening now. */
  set(done: number, total: number, label?: string): void;
}

export function loadingScreen(o: { title: string; label: string; note?: { text: string; by?: string } }): Loader {
  style();
  const root = el("section", "ld");
  root.setAttribute("aria-busy", "true");
  const fill = el("span", "ld-fill");
  const bar = el("div", "ld-bar");
  Object.entries({ role: "progressbar", "aria-label": o.title, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }).forEach(([k, v]) => bar.setAttribute(k, v));
  bar.append(fill);
  const pct = el("span", "ld-pct");
  const meter = el("div", "ld-meter");
  meter.append(bar, pct);
  const label = el("p", "ld-label", o.label);
  label.setAttribute("role", "status");
  root.append(el("h1", "ld-title", o.title), meter, label);
  if (o.note) {
    const n = el("figure", "ld-note", `“${o.note.text}”`);
    if (o.note.by) n.append(el("small", "", `— ${o.note.by}`));
    root.append(n);
  }
  let shown = 0;
  return {
    el: root,
    set(done, total, text) {
      shown = total ? Math.max(shown, Math.min(100, Math.round((done / total) * 100))) : shown;
      fill.style.width = `${Math.max(4, shown)}%`;
      bar.setAttribute("aria-valuenow", String(shown));
      pct.textContent = total ? `${shown}%` : "";
      if (text) label.textContent = text;
    },
  };
}

/** A slim bar along the top if this takes longer than `delay` ms. Call the returned stop() when done. */
export function pending(delay = 150): () => void {
  style();
  let bar: HTMLElement | undefined;
  const t = setTimeout(() => {
    bar = el("div", "pending-bar");
    bar.setAttribute("aria-hidden", "true");
    bar.append(el("span", ""));
    // Inside the themed root, so it gets the theme's colours.
    (document.querySelector(".ui") ?? document.body).append(bar);
  }, delay);
  return () => (clearTimeout(t), bar?.remove());
}
