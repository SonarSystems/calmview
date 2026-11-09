// A small, quiet in-page notice ("Skipped a sponsor segment · Undo") in a shadow root, styled by the
// design system. Never blocks the page; disappears by itself.
import { el, ensureStyles } from "../ui/theme";

let host: HTMLElement | null = null;

function root(): HTMLElement {
  if (host?.isConnected) return host.shadowRoot!.querySelector(".stack") as HTMLElement;
  host = document.createElement("hush-toast");
  host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "open" });
  const ui = el("div", "ui auto");
  const style = el("style");
  style.textContent = `.stack{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.toast{pointer-events:auto;display:flex;gap:10px;align-items:center;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:13px;animation:hush-in .18s ease-out}
.toast.leaving{opacity:0;transition:opacity .2s}
@keyframes hush-in{from{opacity:0;transform:translateY(6px)}}`;
  const stack = el("div", "stack");
  ui.append(stack);
  shadow.append(style, ui);
  (document.body ?? document.documentElement).append(host);
  ensureStyles(stack);
  return stack;
}

export function toast(text: string, action?: { label: string; run: () => void }, ms = 4000): void {
  const stack = root();
  const t = el("div", "toast");
  t.setAttribute("role", "status");
  t.append(el("span", undefined, text));
  if (action) {
    const b = el("button", "btn", action.label);
    b.type = "button";
    b.addEventListener("click", () => {
      action.run();
      t.remove();
    });
    t.append(b);
  }
  stack.append(t);
  setTimeout(() => {
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 250);
  }, ms);
}
