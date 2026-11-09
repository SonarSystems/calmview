// Procedural cosmetic filters (uBlock Origin syntax) that plain CSS can't express:
//   example.com##.post:has-text(/sponsored/i)          hide posts containing text
//   example.com##.ad-label:upward(3)                   hide the label's 3rd ancestor
//   example.com##div[id^="ad"]:remove()                remove instead of hide
//   example.com##.x:matches-css(position: fixed)        computed style test
// Parsed once into steps, run when the DOM is ready and again (throttled) as the page changes.

type Step =
  | { op: "css"; sel: string }
  | { op: "has-text"; test: (t: string) => boolean }
  | { op: "upward"; n?: number; sel?: string }
  | { op: "matches-css"; pseudo: string | null; prop: string; test: (v: string) => boolean }
  | { op: "min-text-length"; n: number }
  | { op: "xpath"; expr: string }
  | { op: "matches-attr"; name: (n: string) => boolean; value: (v: string) => boolean }
  | { op: "has"; sub: Task; not: boolean }
  | { op: "matches-path"; test: (t: string) => boolean };

type Action = { kind: "hide" } | { kind: "remove" } | { kind: "style"; css: string } | { kind: "remove-attr"; name: string } | { kind: "remove-class"; name: string };

export interface Task {
  base: string;
  steps: Step[];
  action: Action;
}

const OPS = ["has-text", "upward", "remove", "style", "matches-css", "matches-css-before", "matches-css-after", "min-text-length", "xpath", "matches-attr", "has", "not", "if", "if-not", "matches-path", "remove-attr", "remove-class", "watch-attr"];

export function textTest(arg: string): (t: string) => boolean {
  const m = /^\/(.+)\/([imsu]*)$/.exec(arg);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2]);
      return (t) => re.test(t);
    } catch {
      return () => false;
    }
  }
  return (t) => t.includes(arg);
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Finds ":op(" at depth 0 and its balanced argument. */
function nextOp(s: string, from: number): { at: number; op: string; arg: string; end: number } | null {
  let depth = 0;
  let quote = "";
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) {
      const m = /^:([a-z-]+)\(/.exec(s.slice(i));
      if (!m || !OPS.includes(m[1])) continue;
      // Native :has()/:not() with plain CSS inside stays CSS.
      const start = i + m[0].length;
      let d = 1;
      let j = start;
      for (; j < s.length && d; j++) {
        if (s[j] === "\\") j++;
        else if (s[j] === "(") d++;
        else if (s[j] === ")") d--;
      }
      if (d) return null;
      const arg = s.slice(start, j - 1);
      if ((m[1] === "has" || m[1] === "not") && !/:(?:has-text|upward|matches-css|min-text-length|xpath|matches-attr|if|if-not|has|not|matches-path)\(/.test(arg)) continue;
      return { at: i, op: m[1], arg, end: j };
    }
  }
  return null;
}

export function parseProcedural(selector: string): Task | null {
  const steps: Step[] = [];
  let action: Action = { kind: "hide" };
  const first = nextOp(selector, 0);
  if (!first) return null;
  const base = selector.slice(0, first.at).trim();
  let cur: typeof first | null = first;
  let pos = first.at;
  while (cur) {
    const between = selector.slice(pos, cur.at).trim();
    if (between) steps.push({ op: "css", sel: between });
    const { op, arg } = cur;
    switch (op) {
      case "has-text":
        steps.push({ op, test: textTest(arg) });
        break;
      case "upward":
        steps.push(/^\d+$/.test(arg.trim()) ? { op, n: Math.min(Number(arg), 64) } : { op, sel: arg });
        break;
      case "matches-css":
      case "matches-css-before":
      case "matches-css-after": {
        const i = arg.indexOf(":");
        if (i < 0) return null;
        steps.push({ op: "matches-css", pseudo: op.endsWith("before") ? "::before" : op.endsWith("after") ? "::after" : null, prop: arg.slice(0, i).trim(), test: textTest(unquote(arg.slice(i + 1).trim())) });
        break;
      }
      case "min-text-length":
        steps.push({ op, n: Number(arg) || 0 });
        break;
      case "xpath":
        steps.push({ op, expr: arg });
        break;
      case "matches-attr": {
        const [n, v = ""] = arg.split("=");
        steps.push({ op, name: textTest(unquote(n)), value: textTest(unquote(v)) });
        break;
      }
      case "matches-path":
        steps.push({ op, test: textTest(arg) });
        break;
      case "has":
      case "if":
      case "not":
      case "if-not": {
        const sub = parseProcedural(arg.trim().startsWith(">") ? `:scope ${arg}` : arg) ?? { base: arg.trim().startsWith(">") ? `:scope ${arg}` : arg, steps: [], action: { kind: "hide" as const } };
        steps.push({ op: "has", sub, not: op === "not" || op === "if-not" });
        break;
      }
      case "remove":
        action = { kind: "remove" };
        break;
      case "style":
        action = { kind: "style", css: arg };
        break;
      case "remove-attr":
        action = { kind: "remove-attr", name: unquote(arg) };
        break;
      case "remove-class":
        action = { kind: "remove-class", name: unquote(arg) };
        break;
      case "watch-attr":
        break;
    }
    pos = cur.end;
    cur = nextOp(selector, pos);
  }
  const tail = selector.slice(pos).trim();
  if (tail) steps.push({ op: "css", sel: tail });
  return { base, steps, action };
}

function safeMatches(e: Element, sel: string): boolean {
  try {
    return e.matches(sel);
  } catch {
    return false;
  }
}

function query(root: ParentNode, sel: string): Element[] {
  try {
    return [...root.querySelectorAll(sel)];
  } catch {
    return [];
  }
}

/** Elements a task selects, starting from `root` (document, or an element for :has()). */
export function select(task: Task, root: ParentNode = document): Element[] {
  let els: Element[] = task.base ? query(root, task.base) : root instanceof Element ? [root] : query(root, "*");
  for (const step of task.steps) {
    if (!els.length) break;
    els = apply(step, els);
  }
  return els;
}

function apply(step: Step, els: Element[]): Element[] {
  switch (step.op) {
    case "css": {
      const out = new Set<Element>();
      const sel = /^[>+~]/.test(step.sel) ? `:scope ${step.sel}` : step.sel;
      const rest = step.sel.slice(1).trim();
      for (const e of els) {
        if (step.sel[0] === ">") for (const x of query(e, sel)) out.add(x);
        else if (step.sel[0] === "+") {
          const n = e.nextElementSibling;
          if (n && safeMatches(n, rest)) out.add(n);
        } else if (step.sel[0] === "~") {
          for (let n = e.nextElementSibling; n; n = n.nextElementSibling) if (safeMatches(n, rest)) out.add(n);
        } else if (safeMatches(e, sel)) out.add(e);
      }
      return [...out];
    }
    case "has-text":
      return els.filter((e) => step.test(e.textContent ?? ""));
    case "upward": {
      const out = new Set<Element>();
      for (const e of els) {
        let x: Element | null = e;
        if (step.n !== undefined) for (let i = 0; i < step.n && x; i++) x = x.parentElement;
        else x = e.parentElement?.closest(step.sel!) ?? null;
        if (x && x !== document.documentElement && x !== document.body) out.add(x);
      }
      return [...out];
    }
    case "matches-css":
      return els.filter((e) => step.test(getComputedStyle(e, step.pseudo).getPropertyValue(step.prop)));
    case "min-text-length":
      return els.filter((e) => (e.textContent ?? "").length >= step.n);
    case "xpath": {
      const out: Element[] = [];
      for (const e of els) {
        try {
          const r = document.evaluate(step.expr, e, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < r.snapshotLength; i++) {
            const n = r.snapshotItem(i);
            if (n instanceof Element) out.push(n);
          }
        } catch {
          /* bad expression */
        }
      }
      return out;
    }
    case "matches-attr":
      return els.filter((e) => [...e.attributes].some((a) => step.name(a.name) && step.value(a.value)));
    case "matches-path":
      return step.test(location.pathname + location.search) ? els : [];
    case "has":
      return els.filter((e) => select(step.sub, e).length > 0 !== step.not);
  }
}

const DONE = "data-hush-done";

function act(task: Task, els: Element[]): number {
  let n = 0;
  for (const e of els) {
    const a = task.action;
    if (a.kind === "remove") e.remove();
    else if (a.kind === "hide") {
      if (e.getAttribute(DONE) === "h") continue;
      (e as HTMLElement).style?.setProperty("display", "none", "important");
      e.setAttribute(DONE, "h");
    } else if (a.kind === "style") {
      for (const decl of a.css.split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const v = decl.slice(i + 1).trim();
        (e as HTMLElement).style?.setProperty(decl.slice(0, i).trim(), v.replace(/\s*!important$/, ""), "important");
      }
    } else if (a.kind === "remove-attr") e.removeAttribute(a.name);
    else if (a.kind === "remove-class") e.classList.remove(a.name);
    n++;
  }
  return n;
}

/** Runs filters now, when the DOM is ready and as it changes. Returns a counter of elements hidden. */
export function runProcedural(selectors: string[]): { hidden: () => number } {
  const tasks = selectors.map(parseProcedural).filter((t): t is Task => !!t);
  let hidden = 0;
  if (!tasks.length) return { hidden: () => 0 };
  let queued = false;
  let budget = 200; // runs; pages that change forever (tickers) shouldn't cost forever
  const run = () => {
    queued = false;
    for (const t of tasks) {
      try {
        hidden += act(t, select(t));
      } catch {
        /* one bad filter mustn't stop the rest */
      }
    }
  };
  const schedule = () => {
    if (queued || budget-- <= 0) return;
    queued = true;
    setTimeout(run, 120);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  return { hidden: () => hidden };
}
