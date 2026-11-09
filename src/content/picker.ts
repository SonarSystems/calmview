// "Hide an element": point at something, click, then Hide. Lives in a shadow root on top of the page,
// changes nothing until the person presses Hide, and Escape always gets out.
import { button, el, ensureStyles } from "../ui/theme";

/** A short, stable CSS selector for `target` (ids and plain class names; no generated junk). */
export function selectorFor(target: Element, doc: Document = document): string {
  const parts: string[] = [];
  const stableId = (id: string) => /^[A-Za-z][\w-]{1,48}$/.test(id) && !/\d{4,}|[a-f0-9]{8,}/i.test(id);
  const stableClass = (c: string) => /^[A-Za-z][\w-]{1,48}$/.test(c) && !/\d{3,}|__[a-z0-9]{5,}$|^(?:active|hover|focus|focused|selected|open|show|shown|visible|hidden|is-|has-)/i.test(c);
  let cur: Element | null = target;
  while (cur && cur !== doc.documentElement && cur !== doc.body) {
    if (cur.id && stableId(cur.id)) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
      break;
    }
    let part = cur.localName;
    const classes = [...cur.classList].filter(stableClass).slice(0, 3);
    part += classes.map((c) => `.${CSS.escape(c)}`).join("");
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = [...parent.children].filter((s) => s.matches(part));
      if (same.length > 1) {
        const ofType = [...parent.children].filter((s) => s.localName === cur!.localName);
        part += `:nth-of-type(${ofType.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    if (doc.querySelectorAll(parts.join(" > ")).length === 1) break;
    cur = parent;
  }
  return parts.join(" > ");
}

const CSS_TEXT = `
:host { all: initial; }
.box { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #4f46e5; background: rgba(79, 70, 229, .14); border-radius: 4px; transition: all .06s; }
.box.picked { border-color: #b91c1c; background: rgba(185, 28, 28, .16); }
.panel { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 2147483647; width: min(440px, calc(100vw - 32px)); background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.25); padding: 12px 14px; }
.panel .t { font-weight: 700; font-size: 14px; }
.panel p { margin: 4px 0 10px; color: var(--muted); font-size: 12.5px; }
.panel code { display: block; font: 11.5px/1.4 ui-monospace, Menlo, monospace; color: var(--ink); background: var(--soft); border-radius: 8px; padding: 6px 8px; margin: 0 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row .sp { flex: 1; }
`;

let active: (() => void) | null = null;

/** Opens the picker. `start` preselects an element (from the right-click menu). */
export function openPicker(onHide: (selector: string, count: number) => void, start?: Element | null): void {
  active?.();
  const host = document.createElement("hush-picker");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS_TEXT;
  const ui = el("div", "ui auto");
  const box = el("div", "box");
  const panel = el("div", "panel");
  panel.style.pointerEvents = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Hide an element");
  ui.append(box, panel);
  shadow.append(style, ui);
  document.documentElement.append(host);
  ensureStyles(panel);

  let hovered: Element | null = null;
  let picked: Element | null = null;
  const trail: Element[] = [];

  const place = (e: Element | null) => {
    if (!e) return void (box.style.display = "none");
    const r = e.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const under = (x: number, y: number): Element | null => {
    for (const e of document.elementsFromPoint(x, y)) if (e !== host && e !== document.documentElement && e !== document.body) return e;
    return null;
  };

  const draw = () => {
    panel.replaceChildren();
    if (!picked) {
      panel.append(el("div", "t", "Click the thing you want to hide"), el("p", undefined, "Move over the page to highlight it. Press Esc to stop."));
      const row = el("div", "row");
      row.append(el("span", "sp"), button("Cancel", close));
      panel.append(row);
      return;
    }
    const sel = selectorFor(picked);
    let count = 0;
    try {
      count = document.querySelectorAll(sel).length;
    } catch {
      count = 1;
    }
    panel.append(el("div", "t", count > 1 ? `Hide ${count} matching items?` : "Hide this item?"), el("p", undefined, "It stays hidden on this site. You can show it again from the Calmview menu."));
    const code = el("code", undefined, sel);
    code.title = sel;
    panel.append(code);
    const row = el("div", "row");
    const bigger = button("Bigger", () => {
      if (picked?.parentElement && picked.parentElement !== document.body && picked.parentElement !== document.documentElement) {
        trail.push(picked);
        picked = picked.parentElement;
        place(picked);
        draw();
      }
    });
    const smaller = button("Smaller", () => {
      const prev = trail.pop();
      if (prev) {
        picked = prev;
        place(picked);
        draw();
      }
    });
    smaller.disabled = !trail.length;
    const hide = button("Hide", () => {
      onHide(sel, count);
      close();
    }, "btn primary");
    row.append(bigger, smaller, el("span", "sp"), button("Cancel", close), hide);
    panel.append(row);
    hide.focus({ preventScroll: true });
  };

  const onMove = (e: MouseEvent) => {
    if (picked) return;
    hovered = under(e.clientX, e.clientY);
    place(hovered);
  };
  const onClick = (e: MouseEvent) => {
    if (e.composedPath().includes(panel)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    picked = under(e.clientX, e.clientY);
    trail.length = 0;
    box.classList.toggle("picked", !!picked);
    place(picked);
    draw();
  };
  const block = (e: Event) => {
    if (e.composedPath().includes(panel)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const onScroll = () => place(picked ?? hovered);

  function close() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.removeEventListener(t, block, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("scroll", onScroll, true);
    host.remove();
    active = null;
  }
  active = close;
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.addEventListener(t, block, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("scroll", onScroll, true);
  if (start && start !== document.body && start !== document.documentElement) {
    picked = start;
    box.classList.add("picked");
    place(picked);
  }
  draw();
}

export const pickerOpen = () => !!active;
