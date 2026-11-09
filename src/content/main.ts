// Content script (isolated world, every frame, document_start). The worker has already injected the
// page's CSS by the time this gets its reply; here we:
//   - report the page's class names and ids so class-keyed generic CSS can be added,
//   - run procedural filters, the YouTube / Twitch helpers, and the element picker,
//   - count what was hidden when the popup asks.
// Guardrails: reads no form values, sends no page content anywhere (only class/id names, to our own
// service worker), and only changes the page to hide ads or when the person uses the picker.
import { openPicker, pickerOpen } from "./picker";
import { runProcedural } from "./procedural";
import { toast } from "./toast";
import { startTwitch } from "./twitch";
import { startYouTube } from "./youtube";

interface PageCfg {
  on: boolean;
  keyed?: boolean;
  procedural?: string[];
  specific?: string[];
  youtube?: { ads: boolean; skipSponsors: boolean } | null;
  twitch?: boolean;
}

const send = <T>(msg: unknown): Promise<T | undefined> =>
  chrome.runtime.sendMessage(msg).then(
    (r) => r as T,
    // The worker can be restarting: try once more.
    () => chrome.runtime.sendMessage(msg).then((r) => r as T, () => undefined),
  );

const selectors = new Set<string>();
let procedural: { hidden: () => number } | null = null;
let lastRightClick: Element | null = null;
let skipped = 0;

function countHidden(): number {
  const list = [...selectors];
  let n = 0;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    try {
      n += document.querySelectorAll(chunk.join(",")).length;
    } catch {
      for (const s of chunk) {
        try {
          n += document.querySelectorAll(s).length;
        } catch {
          /* selector this browser doesn't support */
        }
      }
    }
  }
  return n + (procedural?.hidden() ?? 0);
}

/** Sends new ".class" / "#id" tokens in batches; the worker injects matching generic CSS. */
function watchTokens(): void {
  const seen = new Set<string>();
  let pending: string[] = [];
  let timer = 0;
  const flush = () => {
    timer = 0;
    if (!pending.length) return;
    const tokens = pending;
    pending = [];
    void send<string[]>({ type: "tokens", url: location.href, tokens }).then((sels) => sels?.forEach((s) => selectors.add(s)));
  };
  const add = (e: Element) => {
    if (e.id) {
      const t = `#${e.id}`;
      if (!seen.has(t)) {
        seen.add(t);
        pending.push(t);
      }
    }
    for (const c of e.classList) {
      const t = `.${c}`;
      if (!seen.has(t)) {
        seen.add(t);
        pending.push(t);
      }
    }
  };
  const scan = (root: Element) => {
    add(root);
    for (const e of root.querySelectorAll("[id],[class]")) add(e);
  };
  const schedule = (ms: number) => {
    if (!timer) timer = window.setTimeout(flush, ms);
  };
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") add(r.target as Element);
      else for (const n of r.addedNodes) if (n.nodeType === 1) scan(n as Element);
    }
    if (pending.length) schedule(pending.length > 500 ? 30 : 150);
  });
  mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id"] });
  const first = () => {
    if (document.documentElement) scan(document.documentElement);
    flush();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", first, { once: true });
  else first();
}

function hideNow(selector: string): void {
  try {
    for (const e of document.querySelectorAll<HTMLElement>(selector)) e.style.setProperty("display", "none", "important");
  } catch {
    /* invalid */
  }
}

function site(): string {
  return location.hostname.toLowerCase().replace(/^www\d?\./, "");
}

function pick(start?: Element | null): void {
  if (pickerOpen()) return;
  openPicker((selector, count) => {
    const line = `${site()}##${selector}`;
    hideNow(selector);
    selectors.add(selector);
    void send({ type: "add-filter", line });
    toast(count > 1 ? `Hid ${count} items on ${site()}` : `Hidden on ${site()}`, {
      label: "Undo",
      run: () => {
        void send({ type: "remove-filters", lines: [line] }).then(() => location.reload());
      },
    });
  }, start);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "pick") {
    pick(msg.fromMenu ? lastRightClick : null);
    reply(true);
  } else if (msg?.type === "count") reply({ hidden: countHidden(), skipped });
  return false;
});
document.addEventListener("contextmenu", (e) => (lastRightClick = e.target instanceof Element ? e.target : null), true);

async function start(): Promise<void> {
  const cfg = await send<PageCfg>({ type: "page", url: location.href });
  if (!cfg?.on) return;
  for (const s of cfg.specific ?? []) selectors.add(s);
  if (cfg.keyed) watchTokens();
  if (cfg.procedural?.length) procedural = runProcedural(cfg.procedural);
  const skippedOne = () => {
    skipped++;
    void send({ type: "skipped", n: 1 });
  };
  if (cfg.youtube && window === window.top) startYouTube(cfg.youtube, skippedOne);
  if (cfg.twitch && window === window.top) startTwitch(skippedOne);
}

if (location.protocol === "http:" || location.protocol === "https:") void start();
