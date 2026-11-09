// Scriptlets: small defences that run in the page's own JavaScript world (MAIN) before the page's
// scripts, named and called the way uBlock Origin filter lists write them ("youtube.com##+js(set,
// ytInitialPlayerResponse.adPlacements, undefined)"). Calmview's own implementations; unknown names are
// skipped. Bundled into one file per filter group with that group's per-site table.
//
// Rules: keep native references taken before the page runs, wrap with Proxy (so wrapped functions
// still look native), never throw out of a wrapper, and never send anything anywhere.

import { applyQuery, parseQuery } from "./jsonq";

type Call = [string, ...string[]];
export interface Table {
  run: Record<string, Call[]>;
  except: Record<string, string[]>;
}

const W = window;
const nativeDefine = Object.defineProperty;
const nativeGetDesc = Object.getOwnPropertyDescriptor;
const nativeParse = JSON.parse;
const nativeStringify = JSON.stringify;
const nativeFetch = W.fetch;
const nativeSetTimeout = W.setTimeout;
const NativeMO = W.MutationObserver;
const MAGIC = `hush-${Math.random().toString(36).slice(2, 8)}`;

// ---------- helpers ----------

/** uBO argument patterns: "/re/flags" is a regex, anything else a literal substring; "" matches all. */
export function toRegex(s: string | undefined, flags = ""): RegExp {
  if (!s) return /^/;
  const m = /^\/(.+)\/([gimsu]*)$/.exec(s);
  if (m) {
    try {
      return new RegExp(m[1], m[2] || flags);
    } catch {
      return /(?!)/;
    }
  }
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
}

/** Pattern with an optional leading "!" to negate. */
function matcher(s: string | undefined): (text: string) => boolean {
  if (!s) return () => true;
  const neg = s.startsWith("!");
  const re = toRegex(neg ? s.slice(1) : s);
  return (t) => re.test(t) !== neg;
}

/** Turns a filter-list value token into the JS value it stands for. */
export function constValue(raw: string | undefined, trusted = true): { ok: boolean; value?: unknown } {
  const map: Record<string, unknown> = {
    undefined: undefined,
    false: false,
    true: true,
    null: null,
    noopFunc: function () {},
    trueFunc: () => true,
    falseFunc: () => false,
    throwFunc: () => {
      throw new Error("");
    },
    emptyObj: {},
    emptyArr: [],
    emptyStr: "",
    "''": "",
    '""': "",
    "{}": {},
    "[]": [],
    yes: "yes",
    no: "no",
    NaN: NaN,
    Infinity: Infinity,
    "-1": -1,
    noopCallbackFunc: () => () => {},
  };
  if (raw === undefined || raw === "") return { ok: true, value: raw === "" ? "" : undefined };
  if (raw in map) {
    const v = map[raw];
    if (raw === "emptyObj" || raw === "{}") return { ok: true, value: {} };
    if (raw === "emptyArr" || raw === "[]") return { ok: true, value: [] };
    return { ok: true, value: v };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return { ok: true, value: Number(raw) };
  if (trusted) {
    try {
      return { ok: true, value: nativeParse(raw) };
    } catch {
      return { ok: true, value: raw };
    }
  }
  return { ok: false };
}

/** Our own traps on (object, property), so several scriptlets waiting on one object share it. */
const traps = new WeakMap<object, Map<string, ((v: unknown) => void)[]>>();

/**
 * Calls `onReady(owner, prop)` once the object at `chain` (dotted path from window) exists, trapping
 * each missing link so it's caught the moment the page creates it.
 */
function trapChain(owner: unknown, chain: string, onReady: (owner: Record<string, unknown>, prop: string) => void): void {
  if (!owner || (typeof owner !== "object" && typeof owner !== "function")) return;
  const o = owner as Record<string, unknown>;
  const dot = chain.indexOf(".");
  if (dot < 0) return onReady(o, chain);
  const prop = chain.slice(0, dot);
  const rest = chain.slice(dot + 1);
  let v: unknown;
  try {
    v = o[prop];
  } catch {
    return;
  }
  const next = (a: unknown) => {
    if (a && (typeof a === "object" || typeof a === "function")) trapChain(a, rest, onReady);
  };
  if (v && (typeof v === "object" || typeof v === "function")) return next(v);
  const mine = traps.get(o)?.get(prop);
  if (mine) return void mine.push(next);
  const desc = nativeGetDesc(o, prop);
  if (desc && !desc.configurable) return;
  if (desc?.get || desc?.set) return; // someone else's accessor: don't fight it
  let current = v;
  const waiting = [next];
  try {
    nativeDefine(o, prop, {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (a) => {
        current = a;
        for (const fn of waiting) {
          try {
            fn(a);
          } catch {
            /* keep the page working */
          }
        }
      },
    });
    let byProp = traps.get(o);
    if (!byProp) traps.set(o, (byProp = new Map()));
    byProp.set(prop, waiting);
  } catch {
    /* frozen */
  }
}

function defineConst(owner: Record<string, unknown>, prop: string, value: unknown): void {
  const desc = nativeGetDesc(owner, prop);
  if (desc && !desc.configurable) {
    try {
      if (desc.writable) owner[prop] = value;
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    nativeDefine(owner, prop, { configurable: false, enumerable: desc?.enumerable ?? true, get: () => value, set: () => {} });
  } catch {
    /* ignore */
  }
}

function throwHere(): never {
  throw new ReferenceError(MAGIC);
}

// Swallow our own abort errors so the console stays quiet and pages don't see them as crashes.
W.addEventListener(
  "error",
  (e) => {
    if (typeof e.message === "string" && e.message.includes(MAGIC)) e.preventDefault();
  },
  true,
);

/** Replaces obj[name] with a Proxy around it (keeps toString native-looking). */
function wrapMethod<T extends object>(obj: T, name: string, apply: (target: (...a: unknown[]) => unknown, self: unknown, args: unknown[]) => unknown): void {
  const orig = (obj as Record<string, unknown>)[name];
  if (typeof orig !== "function") return;
  try {
    (obj as Record<string, unknown>)[name] = new Proxy(orig, { apply: (t, self, args) => apply(t as (...a: unknown[]) => unknown, self, args) });
  } catch {
    /* read-only */
  }
}

function onReady(fn: () => void): void {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}

/** Run `fn` now, when the DOM is ready, and (throttled) whenever the page changes. */
function watchDom(fn: () => void): void {
  let queued = false;
  const run = () => {
    queued = false;
    try {
      fn();
    } catch {
      /* ignore */
    }
  };
  run();
  onReady(run);
  const start = () => {
    new NativeMO(() => {
      if (queued) return;
      queued = true;
      nativeSetTimeout(run, 50);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: false });
  };
  if (document.documentElement) start();
}

// ---------- JSON pruning (also used by the YouTube module) ----------

/** Removes `paths` (space-separated; "*" any key, "[]" any index, "[-]" drop the array element) from obj. */
export function prune(obj: unknown, paths: string, required = ""): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (required && !required.split(/\s+/).filter(Boolean).every((p) => has(obj, p.split(".")))) return false;
  let changed = false;
  for (const p of paths.split(/\s+/).filter(Boolean)) if (removePath(obj, p.split("."))) changed = true;
  return changed;
}

function has(o: unknown, parts: string[]): boolean {
  if (!parts.length) return true;
  if (!o || typeof o !== "object") return false;
  const [head, ...rest] = parts;
  if (head === "*" || head === "[]" || head === "[-]") return Object.values(o as object).some((v) => has(v, rest));
  // "key.[=].value" style filters aren't used by the lists we ship.
  return head in (o as object) && has((o as Record<string, unknown>)[head], rest);
}

function removePath(o: unknown, parts: string[]): boolean {
  if (!o || typeof o !== "object") return false;
  const [head, ...rest] = parts;
  const rec = o as Record<string, unknown>;
  if (head === "[-]" && Array.isArray(o)) {
    // Remove whole elements that contain the rest of the path.
    let changed = false;
    for (let i = o.length - 1; i >= 0; i--) {
      if (has(o[i], rest)) {
        o.splice(i, 1);
        changed = true;
      }
    }
    return changed;
  }
  if (head === "*" || head === "[]") {
    let changed = false;
    for (const k of Object.keys(rec)) if (rest.length ? removePath(rec[k], rest) : delete rec[k]) changed = true;
    return changed;
  }
  if (!(head in rec)) return false;
  if (!rest.length) return delete rec[head];
  return removePath(rec[head], rest);
}

// ---------- network helpers ----------

/** "url:/re/ method:POST" or a bare pattern (matches the URL). */
function requestMatcher(spec: string | undefined): (info: Record<string, string>) => boolean {
  if (!spec) return () => true;
  const tests: [string, (t: string) => boolean][] = [];
  for (const part of spec.split(/\s+(?=\w+:)/)) {
    const m = /^(\w+):(.*)$/.exec(part);
    if (m && !/^https?$/.test(m[1])) tests.push([m[1], matcher(m[2])]);
    else tests.push(["url", matcher(part)]);
  }
  return (info) => tests.every(([k, t]) => t(info[k] ?? ""));
}

function extra(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < args.length; i += 2) out[args[i]] = args[i + 1];
  return out;
}

function fetchInfo(args: unknown[]): Record<string, string> {
  const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
  const url = input instanceof Request ? input.url : String(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  return { url, method };
}

/** Rewrites fetch responses whose request matches. */
function hookFetchText(match: (info: Record<string, string>) => boolean, edit: (text: string) => string): void {
  wrapMethod(W, "fetch", (target, self, args) => {
    const p = Reflect.apply(target, self, args) as Promise<Response>;
    let info: Record<string, string>;
    try {
      info = fetchInfo(args);
    } catch {
      return p;
    }
    if (!match(info)) return p;
    return p.then(async (res) => {
      try {
        const text = await res.clone().text();
        const next = edit(text);
        if (next === text) return res;
        const out = new Response(next, { status: res.status, statusText: res.statusText, headers: res.headers });
        nativeDefine(out, "url", { value: res.url });
        nativeDefine(out, "type", { value: res.type });
        return out;
      } catch {
        return res;
      }
    });
  });
}

/** Rewrites XHR responses (responseText / response) whose request matches. */
function hookXhrText(match: (info: Record<string, string>) => boolean, edit: (text: string) => string): void {
  const proto = XMLHttpRequest.prototype;
  const urls = new WeakMap<XMLHttpRequest, Record<string, string>>();
  wrapMethod(proto, "open", (target, self, args) => {
    urls.set(self as XMLHttpRequest, { method: String(args[0]).toUpperCase(), url: String(args[1]) });
    return Reflect.apply(target, self, args);
  });
  const cache = new WeakMap<XMLHttpRequest, { raw: string; out: string }>();
  const edited = (xhr: XMLHttpRequest, raw: string) => {
    const c = cache.get(xhr);
    if (c && c.raw === raw) return c.out;
    const out = edit(raw);
    cache.set(xhr, { raw, out });
    return out;
  };
  for (const prop of ["responseText", "response"] as const) {
    const desc = nativeGetDesc(proto, prop);
    if (!desc?.get) continue;
    const getter = desc.get;
    nativeDefine(proto, prop, {
      ...desc,
      get: new Proxy(getter, {
        apply(t, self: XMLHttpRequest, a) {
          const v = Reflect.apply(t, self, a);
          try {
            const info = urls.get(self);
            if (!info || self.readyState !== 4 || !match(info)) return v;
            if (typeof v === "string") return edited(self, v);
            if (prop === "response" && v && typeof v === "object" && !(v instanceof ArrayBuffer) && !(v instanceof Blob)) {
              return nativeParse(edited(self, nativeStringify(v)));
            }
          } catch {
            /* fall through */
          }
          return v;
        },
      }),
    });
  }
}

function editText(q: NonNullable<ReturnType<typeof parseQuery>>): (t: string) => string {
  return (text) => {
    let obj: unknown;
    try {
      obj = nativeParse(text);
    } catch {
      return text;
    }
    return applyQuery(obj, q) ? nativeStringify(obj) : text;
  };
}

function pruneText(paths: string, required: string): (t: string) => string {
  return (text) => {
    let obj: unknown;
    try {
      obj = nativeParse(text);
    } catch {
      return text;
    }
    return prune(obj, paths, required) ? nativeStringify(obj) : text;
  };
}

function replaceText(pattern: string, replacement: string): (t: string) => string {
  const re = /^\/.+\/[gimsu]*$/.test(pattern) ? toRegex(pattern) : null;
  return (t) => (re ? t.replace(re.global ? re : new RegExp(re.source, re.flags + "g"), replacement) : t.split(pattern).join(replacement));
}

// ---------- the scriptlets ----------

type Fn = (...args: string[]) => void;

export const SCRIPTLETS: Record<string, Fn> = {
  "set-constant"(chain, raw) {
    const { ok, value } = constValue(raw);
    if (!ok || !chain) return;
    trapChain(W, chain, (o, p) => defineConst(o, p, value));
  },
  "abort-on-property-read"(chain) {
    if (!chain) return;
    trapChain(W, chain, (o, p) => {
      try {
        nativeDefine(o, p, { configurable: true, get: throwHere, set: () => {} });
      } catch {
        /* ignore */
      }
    });
  },
  "abort-on-property-write"(chain) {
    if (!chain) return;
    trapChain(W, chain, (o, p) => {
      try {
        nativeDefine(o, p, { configurable: true, get: () => undefined, set: throwHere });
      } catch {
        /* ignore */
      }
    });
  },
  "abort-current-script"(chain, needle, context) {
    if (!chain) return;
    const test = matcher(needle);
    const ctx = matcher(context);
    const thisScript = document.currentScript;
    trapChain(W, chain, (o, p) => {
      const desc = nativeGetDesc(o, p);
      let value = desc && "value" in desc ? desc.value : desc?.get?.call(o);
      const check = () => {
        const s = document.currentScript;
        if (!(s instanceof HTMLScriptElement) || s === thisScript) return;
        const text = s.src || s.textContent || "";
        if (test(text) && ctx(text)) throwHere();
      };
      try {
        nativeDefine(o, p, {
          configurable: true,
          get() {
            check();
            return value;
          },
          set(v) {
            check();
            value = v;
          },
        });
      } catch {
        /* ignore */
      }
    });
  },
  "abort-on-stack-trace"(chain, needle) {
    if (!chain) return;
    const test = matcher(needle);
    trapChain(W, chain, (o, p) => {
      const desc = nativeGetDesc(o, p);
      let value = desc && "value" in desc ? desc.value : desc?.get?.call(o);
      const check = () => {
        const stack = new Error().stack ?? "";
        if (test(stack.split("\n").slice(3).join("\n"))) throwHere();
      };
      try {
        nativeDefine(o, p, {
          configurable: true,
          get() {
            check();
            return value;
          },
          set(v) {
            check();
            value = v;
          },
        });
      } catch {
        /* ignore */
      }
    });
  },
  "addEventListener-defuser"(type, needle) {
    const t = matcher(type);
    const n = matcher(needle);
    wrapMethod(EventTarget.prototype, "addEventListener", (target, self, args) => {
      try {
        const [ev, handler] = args as [string, unknown];
        const text = typeof handler === "function" ? Function.prototype.toString.call(handler) : String(handler);
        if (t(String(ev)) && n(text)) return undefined;
      } catch {
        /* fall through */
      }
      return Reflect.apply(target, self, args);
    });
  },
  "no-setTimeout-if"(needle, delay) {
    timerDefuser("setTimeout", needle, delay);
  },
  "no-setInterval-if"(needle, delay) {
    timerDefuser("setInterval", needle, delay);
  },
  "no-requestAnimationFrame-if"(needle) {
    const n = matcher(needle);
    wrapMethod(W, "requestAnimationFrame", (target, self, args) => {
      const cb = args[0];
      if (n(typeof cb === "function" ? Function.prototype.toString.call(cb) : String(cb))) return 0;
      return Reflect.apply(target, self, args);
    });
  },
  "adjust-setTimeout"(needle, delay, boost) {
    timerBooster("setTimeout", needle, delay, boost);
  },
  "adjust-setInterval"(needle, delay, boost) {
    timerBooster("setInterval", needle, delay, boost);
  },
  "no-window-open-if"(pattern, delay, decoy) {
    const test = matcher(pattern);
    void delay;
    void decoy;
    wrapMethod(W, "open", (target, self, args) => {
      if (!test(String(args[0] ?? ""))) return Reflect.apply(target, self, args);
      // A stand-in window: popunder scripts check .closed and call .close()/.focus().
      const fake = { closed: false, close() {}, focus() {}, blur() {}, postMessage() {}, location: { href: "" }, document: { write() {}, writeln() {}, close() {} }, opener: null };
      return fake;
    });
  },
  "set-cookie"(name, value, path) {
    if (!name) return;
    const { value: v } = constValue(value);
    const text = v === undefined ? "" : String(v);
    const existing = document.cookie.split(";").some((c) => c.trim() === `${encodeURIComponent(name)}=${encodeURIComponent(text)}` || c.trim() === `${name}=${text}`);
    if (existing) return;
    const p = path === "none" ? "" : `; path=${path && path.startsWith("/") ? path : "/"}`;
    document.cookie = `${name}=${encodeURIComponent(text)}${p}; max-age=31536000; samesite=lax`;
  },
  "set-local-storage-item"(key, value) {
    storageItem(W.localStorage, key, value);
  },
  "set-session-storage-item"(key, value) {
    storageItem(W.sessionStorage, key, value);
  },
  "remove-cookie"(needle) {
    const test = matcher(needle);
    const remove = () => {
      for (const c of document.cookie.split(";")) {
        const name = c.split("=")[0].trim();
        if (!name || !test(name)) continue;
        const parts = location.hostname.split(".");
        for (let i = 0; i < parts.length; i++) {
          const domain = parts.slice(i).join(".");
          for (const d of [`; domain=${domain}`, `; domain=.${domain}`, ""]) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
        }
      }
    };
    remove();
    W.addEventListener("beforeunload", remove);
  },
  "href-sanitizer"(selector, source) {
    if (!selector) return;
    const from = source || "text";
    watchDom(() => {
      for (const a of document.querySelectorAll<HTMLAnchorElement>(selector)) {
        let url = "";
        if (from === "text") url = a.textContent?.trim() ?? "";
        else if (from.startsWith("[") && from.endsWith("]")) url = a.getAttribute(from.slice(1, -1)) ?? "";
        else if (from.startsWith("?")) {
          try {
            url = new URL(a.href).searchParams.get(from.slice(1)) ?? "";
          } catch {
            url = "";
          }
        }
        if (/^https?:\/\//.test(url) && a.href !== url) a.href = url;
      }
    });
  },
  "remove-node-text"(nodeName, pattern, ...rest) {
    nodeText(nodeName, pattern, () => "", extra(rest));
  },
  "replace-node-text"(nodeName, pattern, replacement, ...rest) {
    const re = toRegex(pattern);
    nodeText(nodeName, pattern, (t) => t.replace(re, replacement ?? ""), extra(rest));
  },
  "no-xhr-if"(props, directive) {
    const match = requestMatcher(props);
    const proto = XMLHttpRequest.prototype;
    const blocked = new WeakMap<XMLHttpRequest, Record<string, string>>();
    wrapMethod(proto, "open", (target, self, args) => {
      const info = { method: String(args[0]).toUpperCase(), url: String(args[1]) };
      if (match(info)) blocked.set(self as XMLHttpRequest, info);
      else blocked.delete(self as XMLHttpRequest);
      return Reflect.apply(target, self, args);
    });
    wrapMethod(proto, "send", (target, self, args) => {
      const xhr = self as XMLHttpRequest;
      if (!blocked.has(xhr)) return Reflect.apply(target, self, args);
      const body = directive === "true" ? "".padEnd(10, "x") : "";
      for (const [k, v] of Object.entries({ readyState: 4, status: 200, statusText: "OK", responseText: body, response: body, responseURL: blocked.get(xhr)!.url })) {
        try {
          nativeDefine(xhr, k, { value: v, configurable: true });
        } catch {
          /* ignore */
        }
      }
      nativeSetTimeout(() => {
        for (const t of ["readystatechange", "load", "loadend"]) xhr.dispatchEvent(new Event(t));
      }, 1);
      return undefined;
    });
  },
  "no-fetch-if"(props, body) {
    const match = requestMatcher(props);
    wrapMethod(W, "fetch", (target, self, args) => {
      let info: Record<string, string>;
      try {
        info = fetchInfo(args);
      } catch {
        return Reflect.apply(target, self, args);
      }
      if (!match(info)) return Reflect.apply(target, self, args);
      const text = body === "emptyObj" ? "{}" : body === "emptyArr" ? "[]" : body && body !== "true" ? "" : "";
      return Promise.resolve(new Response(text, { status: 200, statusText: "OK", headers: { "content-type": "text/plain" } }));
    });
  },
  nowebrtc() {
    const Stub = function () {
      return { close() {}, createDataChannel() {}, createOffer: () => Promise.resolve(), setLocalDescription: () => Promise.resolve(), addEventListener() {} };
    };
    for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection"]) if (k in W) defineConst(W as unknown as Record<string, unknown>, k, Stub);
  },
  "remove-class"(classes, selector) {
    if (!classes) return;
    const list = classes.split(/[|\s]+/).filter(Boolean);
    const sel = selector || list.map((c) => `.${CSS.escape(c)}`).join(",");
    watchDom(() => {
      for (const el of document.querySelectorAll(sel)) el.classList.remove(...list);
    });
  },
  "remove-attr"(attrs, selector) {
    if (!attrs) return;
    const list = attrs.split(/[|\s]+/).filter(Boolean);
    const sel = selector || list.map((a) => `[${CSS.escape(a)}]`).join(",");
    watchDom(() => {
      for (const el of document.querySelectorAll(sel)) for (const a of list) el.removeAttribute(a);
    });
  },
  "set-attr"(selector, attr, value) {
    if (!selector || !attr || /^on/i.test(attr)) return;
    const v = value ?? "";
    if (/^\s*javascript:/i.test(v)) return;
    watchDom(() => {
      for (const el of document.querySelectorAll(selector)) {
        if (/^\[.+\]$/.test(v)) el.setAttribute(attr, el.getAttribute(v.slice(1, -1)) ?? "");
        else if (el.getAttribute(attr) !== v) el.setAttribute(attr, v);
      }
    });
  },
  noeval() {
    wrapMethod(W, "eval", () => undefined);
  },
  "noeval-if"(needle) {
    const n = matcher(needle);
    wrapMethod(W, "eval", (target, self, args) => (n(String(args[0])) ? undefined : Reflect.apply(target, self, args)));
  },
  "json-prune"(paths, required) {
    if (!paths) return;
    wrapMethod(JSON, "parse", (target, self, args) => {
      const obj = Reflect.apply(target, self, args);
      try {
        prune(obj, paths, required);
      } catch {
        /* ignore */
      }
      return obj;
    });
    wrapMethod(Response.prototype, "json", (target, self, args) =>
      (Reflect.apply(target, self, args) as Promise<unknown>).then((obj) => {
        try {
          prune(obj, paths, required);
        } catch {
          /* ignore */
        }
        return obj;
      }),
    );
  },
  "json-prune-fetch-response"(paths, required, ...rest) {
    if (!paths) return;
    hookFetchText(requestMatcher(extra(rest).propsToMatch), pruneText(paths, required ?? ""));
  },
  "json-prune-xhr-response"(paths, required, ...rest) {
    if (!paths) return;
    hookXhrText(requestMatcher(extra(rest).propsToMatch), pruneText(paths, required ?? ""));
  },
  "trusted-replace-fetch-response"(pattern, replacement, props) {
    if (!pattern) return;
    hookFetchText(requestMatcher(props), replaceText(pattern, replacement ?? ""));
  },
  "trusted-replace-xhr-response"(pattern, replacement, props) {
    if (!pattern) return;
    hookXhrText(requestMatcher(props), replaceText(pattern, replacement ?? ""));
  },
  /** Edits an argument before a function sees it, e.g. YouTube's player request in JSON.stringify. */
  "trusted-edit-inbound-object"(chain, argPos, query) {
    const q = parseQuery(query ?? "");
    const pos = Number(argPos) || 0;
    if (!q || !chain) return;
    const dot = chain.lastIndexOf(".");
    const owner = dot < 0 ? W : (chain.slice(0, dot).split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], W) as object);
    if (!owner) return;
    wrapMethod(owner, chain.slice(dot + 1), (target, self, args) => {
      const a = args[pos];
      if (a && typeof a === "object") {
        try {
          // Edit a copy so the page's own object stays as it was.
          const copy = nativeParse(nativeStringify(a));
          if (applyQuery(copy, q)) args = [...args.slice(0, pos), copy, ...args.slice(pos + 1)];
        } catch {
          /* not JSON-safe: leave it */
        }
      }
      return Reflect.apply(target, self, args);
    });
  },
  "json-edit"(query) {
    const q = parseQuery(query ?? "");
    if (!q) return;
    wrapMethod(JSON, "parse", (target, self, args) => {
      const obj = Reflect.apply(target, self, args);
      try {
        applyQuery(obj, q);
      } catch {
        /* ignore */
      }
      return obj;
    });
  },
  "json-edit-fetch-response"(query, ...rest) {
    const q = parseQuery(query ?? "");
    if (!q) return;
    hookFetchText(requestMatcher(extra(rest).propsToMatch), editText(q));
  },
  "json-edit-xhr-response"(query, ...rest) {
    const q = parseQuery(query ?? "");
    if (!q) return;
    hookXhrText(requestMatcher(extra(rest).propsToMatch), editText(q));
  },
  /** Stops a page fetching a clean copy of a function (fetch, Request…) from a fresh iframe. */
  "trusted-prevent-dom-bypass"(methodChain, targetProp) {
    if (!methodChain) return;
    const dot = methodChain.lastIndexOf(".");
    const owner = methodChain.slice(0, dot).split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], W) as object | undefined;
    if (!owner) return;
    wrapMethod(owner, methodChain.slice(dot + 1), (target, self, args) => {
      const out = Reflect.apply(target, self, args);
      try {
        const node = args[0];
        const frames = node instanceof HTMLIFrameElement ? [node] : node instanceof Element ? [...node.querySelectorAll("iframe")] : [];
        for (const f of frames) {
          const win = f.contentWindow as unknown as Record<string, unknown> | null;
          if (!win) continue;
          if (targetProp) {
            const ours = (W as unknown as Record<string, unknown>)[targetProp];
            nativeDefine(win, targetProp, { value: ours, configurable: true, writable: true });
          } else nativeDefine(f, "contentWindow", { value: W, configurable: true });
        }
      } catch {
        /* cross-origin frame: nothing to borrow from it anyway */
      }
      return out;
    });
  },
  "popads-dummy"() {
    for (const k of ["PopAds", "popns"]) defineConst(W as unknown as Record<string, unknown>, k, {});
  },
  "bab-defuser"() {
    adblockDetectorStub("blockAdBlock", "BlockAdBlock");
  },
  "fuckadblock-defuser"() {
    adblockDetectorStub("fuckAdBlock", "FuckAdBlock");
    adblockDetectorStub("blockAdBlock", "BlockAdBlock");
  },
  "prevent-refresh"() {
    onReady(() => {
      for (const m of document.querySelectorAll('meta[http-equiv="refresh" i]')) m.remove();
    });
  },
  "disable-newtab-links"() {
    document.addEventListener(
      "click",
      (e) => {
        const a = (e.target as Element | null)?.closest?.("a[target]");
        if (a) a.removeAttribute("target");
      },
      true,
    );
  },
};

function timerDefuser(kind: "setTimeout" | "setInterval", needle?: string, delay?: string): void {
  const n = matcher(needle);
  const dneg = delay?.startsWith("!");
  const d = delay ? Number(dneg ? delay.slice(1) : delay) : NaN;
  wrapMethod(W, kind, (target, self, args) => {
    try {
      const [cb, ms] = args;
      const text = typeof cb === "function" ? Function.prototype.toString.call(cb) : String(cb);
      const delayOk = Number.isNaN(d) || (Number(ms) === d) !== !!dneg;
      if (n(text) && delayOk) return Reflect.apply(target, self, [() => {}, ms]);
    } catch {
      /* fall through */
    }
    return Reflect.apply(target, self, args);
  });
}

function timerBooster(kind: "setTimeout" | "setInterval", needle?: string, delay?: string, boost?: string): void {
  const n = matcher(needle && needle !== "*" ? needle : "");
  const d = delay === "*" ? NaN : Number(delay || 1000);
  const b = Math.min(Math.max(Number(boost || 0.05), 0.001), 50);
  wrapMethod(W, kind, (target, self, args) => {
    try {
      const [cb, ms] = args;
      const text = typeof cb === "function" ? Function.prototype.toString.call(cb) : String(cb);
      if (n(text) && (Number.isNaN(d) || Number(ms) === d)) return Reflect.apply(target, self, [cb, Number(ms) * b, ...args.slice(2)]);
    } catch {
      /* fall through */
    }
    return Reflect.apply(target, self, args);
  });
}

function storageItem(store: Storage | undefined, key?: string, value?: string): void {
  if (!store || !key) return;
  try {
    if (value === "$remove$" || value === undefined || value === "undefined") return void store.removeItem(key);
    let v: string;
    if (value === "$now$") v = String(Date.now());
    else if (value === "$currentDate$") v = String(new Date());
    else if (value === "emptyObj") v = "{}";
    else if (value === "emptyArr") v = "[]";
    else if (value === "emptyStr" || value === "''") v = "";
    else v = value;
    if (store.getItem(key) !== v) store.setItem(key, v);
  } catch {
    /* storage blocked */
  }
}

function nodeText(nodeName: string | undefined, pattern: string | undefined, edit: (t: string) => string, opts: Record<string, string>): void {
  if (!nodeName || !pattern) return;
  const name = nodeName.toUpperCase();
  const test = toRegex(pattern);
  const cond = opts.condition ? toRegex(opts.condition) : null;
  // "excludes, X": leave nodes containing X alone. "sedCount, N": stop after N replacements.
  const excludes = opts.excludes ? toRegex(opts.excludes) : null;
  let left = Number(opts.sedCount) || Infinity;
  const handle = (node: Node) => {
    if (left <= 0) return;
    if (node.nodeName !== name && !(name === "#TEXT" && node.nodeType === 3)) return;
    const text = node.textContent ?? "";
    if (!test.test(text) || (cond && !cond.test(text)) || (excludes && excludes.test(text))) return;
    left--;
    const next = edit(text);
    if (next !== text) node.textContent = next;
  };
  const start = () => {
    const mo = new NativeMO((records) => {
      for (const r of records) for (const n of r.addedNodes) handle(n);
    });
    mo.observe(document, { childList: true, subtree: true });
    if (opts.quitAfter) nativeSetTimeout(() => mo.disconnect(), Number(opts.quitAfter) || 0);
    else onReady(() => nativeSetTimeout(() => mo.disconnect(), 5000));
  };
  start();
}

function adblockDetectorStub(instance: string, ctor: string): void {
  const Fake = function (this: Record<string, unknown>) {
    const self = this;
    self.onDetected = () => self;
    self.onNotDetected = (fn: () => void) => {
      try {
        nativeSetTimeout(fn, 1);
      } catch {
        /* ignore */
      }
      return self;
    };
    self.on = (detected: boolean, fn: () => void) => (detected ? self : (self.onNotDetected as (f: () => void) => unknown)(fn));
    self.check = () => false;
    self.emitEvent = () => self;
    self.clearEvent = () => {};
    self.setOption = () => self;
  } as unknown as new () => object;
  const rec = W as unknown as Record<string, unknown>;
  defineConst(rec, ctor, Fake);
  defineConst(rec, instance, new Fake());
}

// ---------- entry ----------

/** Same as lib/filters/compile.ts hostKeys (duplicated so this file has no imports beyond itself). */
function keysFor(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  const keys: string[] = [];
  for (let i = 0; i < labels.length; i++) keys.push(labels.slice(i).join("."));
  for (let i = 0; i < labels.length - 1; i++) for (let end = labels.length - 1; end >= Math.max(i + 1, labels.length - 2); end--) keys.push(`${labels.slice(i, end).join(".")}.*`);
  return keys;
}

/** Runs the calls in `table` that apply to this page. Returns what ran (for tests). */
export function run(table: Table, hostname = location.hostname): string[] {
  if (!hostname) return [];
  const keys = keysFor(hostname);
  const off = new Set<string>([...(table.except["*"] ?? [])]);
  for (const k of keys) for (const n of table.except[k] ?? []) off.add(n);
  if (off.has("*")) return [];
  const ran: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    for (const call of table.run[k] ?? []) {
      const sig = nativeStringify(call);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const [name, ...args] = call;
      const fn = SCRIPTLETS[name];
      // Exceptions name the exact call they cancel (see compile.ts scriptletSig).
      if (!fn || off.has(sig)) continue;
      try {
        fn(...args);
        ran.push(name);
      } catch {
        /* one broken filter mustn't stop the rest */
      }
    }
  }
  return ran;
}

void nativeFetch;
