// Design system for every surface (popup, options, in-page panels): tokens for light and dark mode,
// a few components, and safe DOM helpers. Contrast is AA in both themes (checked by test/ui-checks.ts).
//
// Rules: inject styles into every root you render into (ensureStyles), never put page text through
// innerHTML (use el()/textContent), use line icons (ICONS) rather than emoji, and design an empty state
// for every state a surface can be in (can't run here / nothing to do / loading / results).

export const STYLES = `
:host { all: initial; }
.ui, .ui * { box-sizing: border-box; }
/* An inline display:flex beats the hidden attribute; make hidden always win. */
.ui [hidden] { display: none !important; }
.ui {
  --ink: #0f172a; --muted: #5b6577; --line: #e2e8f0; --bg: #ffffff; --soft: #f8fafc;
  --brand: #4338ca; --on-brand: #ffffff; --brand-soft: #eef2ff;
  --danger: #b91c1c; --danger-bg: #fef2f2; --warn: #b45309; --warn-bg: #fffbeb; --good: #15803d; --good-bg: #f0fdf4;
  --track: #94a3b8; --on: #15803d;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .ui.auto { --ink: #e2e8f0; --muted: #94a3b8; --line: #334155; --bg: #0f172a; --soft: #1e293b;
    --brand: #a5b4fc; --on-brand: #0f172a; --brand-soft: #1e1b4b;
    --danger: #f87171; --danger-bg: #3b1219; --warn: #fbbf24; --warn-bg: #33240a; --good: #4ade80; --good-bg: #0b2a1a;
    --track: #475569; --on: #22c55e; }
}
.card { background: var(--bg); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; max-height: inherit; }
.ui.flat .card { border-radius: 0; }
.head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.head img, .head svg { width: 28px; height: 28px; flex: none; border-radius: 7px; }
.head .name { font-weight: 750; font-size: 15px; letter-spacing: -0.01em; }
.head .sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .sp { flex: 1; }
.body { overflow-y: auto; padding: 4px 14px 12px; }
h3 { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 14px 0 8px; }
.item { border-radius: 12px; padding: 10px 12px; margin: 8px 0; background: var(--soft); border-left: 4px solid var(--line); }
.item.danger { background: var(--danger-bg); border-left-color: var(--danger); }
.item.warn { background: var(--warn-bg); border-left-color: var(--warn); }
.item .t { font-weight: 650; }
.item p { margin: 4px 0 0; font-size: 13px; }
.btn, .icon-btn { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600; border-radius: 999px; }
.btn { padding: 5px 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
.btn:hover { border-color: var(--brand); color: var(--brand); }
.btn.primary { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.icon-btn { color: var(--muted); padding: 4px 8px; border-radius: 8px; font-weight: 500; font-size: 13px; }
.icon-btn:hover { background: var(--soft); color: var(--ink); }
.icon-btn svg { width: 18px; height: 18px; display: block; }
.btn:focus-visible, .icon-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
/* A button running an async action (see busy()): spinner, no second press. */
.btn[aria-busy="true"] { cursor: progress; opacity: .8; }
.btn[aria-busy="true"]::after { content: ""; display: inline-block; vertical-align: -2px; margin-left: 6px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: ui-spin .7s linear infinite; }
@keyframes ui-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ui *, .ui *::before, .ui *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; } }
.es { padding: 14px 0 6px; }
.es-title { font-weight: 700; font-size: 15px; }
.es p { margin: 4px 0 12px; color: var(--muted); font-size: 13px; }
.features { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.features li { display: flex; gap: 10px; align-items: center; background: var(--soft); border-radius: 12px; padding: 9px 11px; }
.features .fi { width: 32px; height: 32px; flex: none; border-radius: 9px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); }
.features .fi svg { width: 18px; height: 18px; }
.features b { display: block; font-size: 13px; font-weight: 650; }
.features .d { display: block; color: var(--muted); font-size: 12px; }
/* Switch (role="switch", aria-checked) */
.switch { all: unset; position: relative; width: 44px; height: 26px; border-radius: 999px; background: var(--track); cursor: pointer; flex: none; transition: background .15s; }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); transition: transform .15s; }
.switch[aria-checked="true"] { background: var(--on); }
.switch[aria-checked="true"]::after { transform: translateX(18px); }
.switch:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.switch[disabled] { opacity: .5; cursor: default; }
/* Site card, numbers, chips, actions */
.site { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 14px; background: var(--good-bg); margin-top: 12px; }
.site.paused { background: var(--warn-bg); }
.site .si { width: 36px; height: 36px; flex: none; border-radius: 10px; display: grid; place-items: center; background: var(--bg); color: var(--on); }
.site.paused .si { color: var(--warn); }
.site .si svg { width: 20px; height: 20px; }
.site .tx { flex: 1; min-width: 0; }
.site .tx b { display: block; font-size: 14px; }
.site .tx span { display: block; font-size: 12.5px; color: var(--ink); opacity: .85; }
.count { display: flex; align-items: baseline; gap: 8px; margin: 16px 2px 8px; }
.count .big { font-size: 34px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.count .lbl { color: var(--muted); font-size: 13px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 4px; }
.chip { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--soft); color: var(--ink); }
.chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--dot, var(--muted)); flex: none; }
.action { all: unset; box-sizing: border-box; display: flex; gap: 10px; align-items: center; width: 100%; padding: 10px 12px; margin-top: 10px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); cursor: pointer; font-weight: 600; font-size: 13.5px; }
.action:hover { border-color: var(--brand); }
.action:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.action svg { width: 18px; height: 18px; color: var(--brand); flex: none; }
.action .sub { margin-left: auto; color: var(--muted); font-weight: 500; font-size: 12px; }
.trow { display: flex; gap: 10px; align-items: center; padding: 8px 0; }
.trow + .trow { border-top: 1px solid var(--line); }
.trow .tx { flex: 1; min-width: 0; }
.trow .tx b { display: block; font-size: 13.5px; font-weight: 600; }
.trow .tx span { display: block; font-size: 12px; color: var(--muted); }
.linkish { all: unset; cursor: pointer; color: var(--brand); font-weight: 600; font-size: 12.5px; }
.linkish:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 4px; }
.note { font-size: 12.5px; color: var(--muted); margin: 6px 2px 0; }
.help { margin-top: 6px; padding: 4px 12px; border-radius: 12px; background: var(--soft); }
a.btn { text-decoration: none; }
.skel { background: var(--soft); border-radius: 10px; animation: ui-pulse 1.2s ease-in-out infinite; }
@keyframes ui-pulse { 50% { opacity: .55; } }
.foot { border-top: 1px solid var(--line); padding: 9px 14px; color: var(--muted); font-size: 11.5px; display: flex; gap: 6px; align-items: center; }
.foot svg { width: 13px; height: 13px; flex: none; }
`;

/** Adds the styles once to whatever root `el` lives in: the page (popup/options) or a shadow root. */
export function ensureStyles(target: Element): void {
  const root = target.getRootNode() as Document | ShadowRoot;
  const holder = root instanceof Document ? root.head : root;
  if (holder.querySelector?.("style[data-ui]")) return;
  const style = document.createElement("style");
  style.dataset.ui = "";
  style.textContent = STYLES;
  holder.append(style);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(label: string, onClick: () => void, cls = "btn", title?: string): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  if (title) {
    b.title = title;
    // Icon-only buttons ("✕") need a real name for screen readers.
    if (!/[A-Za-z0-9]/.test(label)) b.setAttribute("aria-label", title);
  }
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** Run an async action from a button: it shows a spinner and ignores presses until it's done. */
export async function busy(btn: HTMLButtonElement, run: () => Promise<void>): Promise<void> {
  if (btn.getAttribute("aria-busy") === "true") return;
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  try {
    await run();
  } finally {
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
  }
}

/** Line icons (24×24, stroke = currentColor). Constants only, never page content. */
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  spark: svg('<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>'),
  check: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.5l2.7 2.7L16.5 9"/>'),
  clock: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>'),
  lock: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  shield: svg('<path d="M12 3l7 2.5V11c0 4.4-3 8-7 10-4-2-7-5.6-7-10V5.5z"/><path d="M9 12h6"/>'),
  pause: svg('<path d="M12 3l7 2.5V11c0 4.4-3 8-7 10-4-2-7-5.6-7-10V5.5z"/><path d="M10 9v6M14 9v6"/>'),
  target: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  play: svg('<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  power: svg('<path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>'),
  alert: svg('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
};

/** An accessible on/off switch. */
export function toggle(label: string, on: boolean, onChange: (on: boolean) => void, disabled = false): HTMLButtonElement {
  const b = el("button", "switch");
  b.type = "button";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(on));
  b.setAttribute("aria-label", label);
  b.disabled = disabled;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return b;
}

export function icon(name: keyof typeof ICONS, cls = ""): HTMLElement {
  const span = el("span", cls);
  span.innerHTML = ICONS[name]; // constant
  return span;
}

/** A card with the extension's header and privacy footer; returns the body to fill. */
export function shell(root: HTMLElement, opts: { title: string; sub?: string; logo?: string; flat?: boolean; actions?: HTMLElement[]; footer?: string }): HTMLElement {
  ensureStyles(root);
  root.replaceChildren();
  const ui = el("div", `ui auto${opts.flat ? " flat" : ""}`);
  const card = el("div", "card");
  const head = el("div", "head");
  if (opts.logo) {
    const img = el("img");
    img.src = opts.logo;
    img.alt = "";
    head.append(img);
  }
  const titles = el("div");
  titles.append(el("div", "name", opts.title));
  if (opts.sub) titles.append(el("div", "sub", opts.sub));
  head.append(titles, el("span", "sp"), ...(opts.actions ?? []));
  const body = el("div", "body");
  const foot = el("div", "foot");
  // Say exactly what the extension sends, and nothing more reassuring than that.
  foot.append(icon("lock"), opts.footer ?? "Runs in your browser. No account, no tracking.");
  card.append(head, body, foot);
  ui.append(card);
  root.append(ui);
  return body;
}

/** An empty state: what's going on, and what the extension does. */
export function emptyState(title: string, text: string, features: [keyof typeof ICONS, string, string][] = []): HTMLElement {
  const box = el("div", "es");
  box.append(el("div", "es-title", title), el("p", undefined, text));
  if (features.length) {
    const ul = el("ul", "features");
    for (const [name, label, desc] of features) {
      const li = el("li");
      const t = el("div");
      t.append(el("b", undefined, label), el("span", "d", desc));
      li.append(icon(name, "fi"), t);
      ul.append(li);
    }
    box.append(ul);
  }
  return box;
}
