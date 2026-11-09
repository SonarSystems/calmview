// A small JSON query/edit language, as uBlock Origin filter lists write it for json-edit and
// trusted-edit-inbound-object (used by YouTube's rules). Calmview's own implementation of the subset the
// lists use:
//   a.b.c                    walk keys          ..key        any depth        .*  /  [*]   every child
//   [?.path]                 keep nodes where path exists
//   [?.path=="x"]  [?.path*="x"]  [?.path=/re/]   …whose value equals / contains / matches
//   (nothing after the path)        delete what the path selects
//   path={"json"} / ="${now}" / =repl({"regex":"…","replacement":"…"})   set
//   path+={"json"}                  merge into the object
// Returns whether anything changed. Unknown syntax changes nothing.

type Json = unknown;
type Filter = { path: string[]; op?: "==" | "*=" | "~"; value?: string | RegExp };
type Step = { kind: "key"; key: string } | { kind: "deep"; key: string } | { kind: "all" } | { kind: "filter"; f: Filter };

export interface Query {
  steps: Step[];
  op: "delete" | "set" | "merge";
  value?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function splitTop(s: string): { path: string; op: Query["op"]; value?: string } {
  // The operator is the first "+=" or "=" outside brackets and quotes.
  let depth = 0;
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "(" || c === "{") depth++;
    else if (c === "]" || c === ")" || c === "}") depth--;
    else if (depth === 0 && c === "+" && s[i + 1] === "=") return { path: s.slice(0, i), op: "merge", value: s.slice(i + 2) };
    else if (depth === 0 && c === "=" && s[i + 1] !== "=") return { path: s.slice(0, i), op: "set", value: s.slice(i + 1) };
  }
  return { path: s, op: "delete" };
}

function parseFilter(body: string): Filter | null {
  // body: ".a.b" | ".a.b=="x"" | ".a.b*="x"" | ".a.b=/re/"
  const m = /^\.?([\w.$-]+)(?:(==|\*=|=)(.+))?$/.exec(body.trim());
  if (!m) return null;
  const path = m[1].split(".");
  if (!m[2]) return { path };
  const raw = m[3].trim();
  if (m[2] === "=" && /^\/.+\/[a-z]*$/.test(raw)) {
    const r = /^\/(.+)\/([a-z]*)$/.exec(raw)!;
    try {
      return { path, op: "~", value: new RegExp(r[1], r[2]) };
    } catch {
      return null;
    }
  }
  const str = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return { path, op: m[2] === "*=" ? "*=" : "==", value: str };
}

export function parseQuery(q: string): Query | null {
  const { path, op, value } = splitTop(q.trim());
  const steps: Step[] = [];
  let i = 0;
  const s = path;
  while (i < s.length) {
    if (s.startsWith("..", i)) {
      const m = /^\.\.([\w$-]+)/.exec(s.slice(i));
      if (!m) return null;
      steps.push({ kind: "deep", key: m[1] });
      i += m[0].length;
    } else if (s.startsWith(".*", i) || s.startsWith("[*]", i)) {
      steps.push({ kind: "all" });
      i += s.startsWith(".*", i) ? 2 : 3;
    } else if (s.startsWith("[?", i)) {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "[") depth++;
        else if (s[j] === "]" && --depth === 0) break;
      }
      const f = parseFilter(s.slice(i + 2, j));
      if (!f) return null;
      steps.push({ kind: "filter", f });
      i = j + 1;
    } else {
      const m = /^\.?([\w$-]+)/.exec(s.slice(i));
      if (!m) return null;
      steps.push({ kind: "key", key: m[1] });
      i += m[0].length;
    }
  }
  return { steps, op, value };
}

function get(o: unknown, path: string[]): unknown {
  let x = o;
  for (const k of path) {
    if (!isObj(x) || !(k in x)) return undefined;
    x = x[k];
  }
  return x;
}

function passes(node: unknown, f: Filter): boolean {
  const v = get(node, f.path);
  if (v === undefined) return false;
  if (!f.op) return true;
  const text = typeof v === "string" ? v : JSON.stringify(v);
  if (f.op === "==") return text === f.value;
  if (f.op === "*=") return text.includes(f.value as string);
  return (f.value as RegExp).test(text);
}

/** Parent + key pairs a query selects (so they can be deleted or set). */
function select(root: unknown, steps: Step[]): { parent: Record<string, unknown> | unknown[] | null; key: string | number | null; node: unknown }[] {
  let cur: { parent: Record<string, unknown> | unknown[] | null; key: string | number | null; node: unknown }[] = [{ parent: null, key: null, node: root }];
  for (const st of steps) {
    const next: typeof cur = [];
    for (const c of cur) {
      if (st.kind === "filter") {
        if (passes(c.node, st.f)) next.push(c);
      } else if (st.kind === "key") {
        if (isObj(c.node) && st.key in c.node) next.push({ parent: c.node as Record<string, unknown>, key: st.key, node: (c.node as Record<string, unknown>)[st.key] });
      } else if (st.kind === "all") {
        if (Array.isArray(c.node)) c.node.forEach((v, i) => next.push({ parent: c.node as unknown[], key: i, node: v }));
        else if (isObj(c.node)) for (const [k, v] of Object.entries(c.node)) next.push({ parent: c.node, key: k, node: v });
      } else {
        const walk = (n: unknown, depth: number) => {
          if (!isObj(n) || depth > 40) return;
          for (const [k, v] of Object.entries(n)) {
            if (k === st.key) next.push({ parent: n as Record<string, unknown>, key: Array.isArray(n) ? Number(k) : k, node: v });
            walk(v, depth + 1);
          }
        };
        walk(c.node, 0);
      }
    }
    cur = next;
    if (!cur.length) break;
  }
  return cur;
}

function valueOf(raw: string, old: unknown): { ok: boolean; v?: unknown } {
  const t = raw.trim();
  if (t === '"${now}"' || t === "${now}") return { ok: true, v: String(Date.now()) };
  const repl = /^repl\((\{.*\})\)$/s.exec(t);
  if (repl) {
    try {
      const spec = JSON.parse(repl[1].replace(/\\,/g, ",")) as { regex: string; replacement: string };
      if (typeof old !== "string") return { ok: false };
      const m = /^\/(.+)\/([a-z]*)$/.exec(spec.regex);
      const re = m ? new RegExp(m[1], m[2]) : new RegExp(spec.regex);
      return { ok: true, v: old.replace(re, spec.replacement) };
    } catch {
      return { ok: false };
    }
  }
  try {
    return { ok: true, v: JSON.parse(t.replace(/\\,/g, ",")) };
  } catch {
    return { ok: false };
  }
}

export function applyQuery(root: unknown, q: Query | null): boolean {
  if (!q || !isObj(root)) return false;
  const last = q.steps[q.steps.length - 1];
  // Setting a plain key creates it when it isn't there yet (lactMilliseconds="${now}").
  if (q.op === "set" && last?.kind === "key") {
    let changed = false;
    for (const h of select(root, q.steps.slice(0, -1))) {
      if (!isObj(h.node)) continue;
      const v = valueOf(q.value ?? "", (h.node as Record<string, unknown>)[last.key]);
      if (v.ok) {
        (h.node as Record<string, unknown>)[last.key] = v.v;
        changed = true;
      }
    }
    return changed;
  }
  const hits = select(root, q.steps);
  let changed = false;
  // Delete from the end so array indexes stay valid.
  for (const h of [...hits].reverse()) {
    if (h.parent === null || h.key === null) {
      if (q.op === "merge" && isObj(h.node)) {
        const add = valueOf(q.value ?? "", h.node);
        if (add.ok && isObj(add.v)) {
          Object.assign(h.node, add.v);
          changed = true;
        }
      }
      continue;
    }
    const parent = h.parent as Record<string | number, unknown>;
    if (q.op === "delete") {
      if (Array.isArray(parent)) parent.splice(h.key as number, 1);
      else delete parent[h.key];
      changed = true;
    } else if (q.op === "set") {
      const v = valueOf(q.value ?? "", h.node);
      if (v.ok) {
        parent[h.key] = v.v;
        changed = true;
      }
    } else if (isObj(h.node)) {
      const add = valueOf(q.value ?? "", h.node);
      if (add.ok && isObj(add.v)) {
        Object.assign(h.node, add.v);
        changed = true;
      }
    }
  }
  return changed;
}
