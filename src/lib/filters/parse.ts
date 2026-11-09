// Parses one line of an Adblock Plus / uBlock Origin style filter list into a typed filter.
// Shared by the build-time compiler (scripts/compile-lists) and "My filters" in Settings, so both
// read lists the same way. Anything we can't honour safely parses to null and is skipped: a filter
// that loses an option (say, its domain limit) must never become broader than its author meant.

export type ResourceType = "main_frame" | "sub_frame" | "stylesheet" | "script" | "image" | "font" | "object" | "xmlhttprequest" | "ping" | "csp_report" | "media" | "websocket" | "webtransport" | "webbundle" | "other";

export interface NetworkFilter {
  kind: "network";
  exception: boolean;
  /** urlFilter syntax (ABP and DNR agree: ||, |, *, ^) or empty for "every URL". */
  pattern: string;
  /** A /regex/ filter, already checked to be RE2-safe. */
  regex?: string;
  /** Hostname when the pattern is exactly ||host^ (lets the compiler merge thousands into one rule). */
  host?: string;
  types: ResourceType[];
  notTypes: ResourceType[];
  /** Also blocks top-level pages: $document, $popup or $all. */
  page: boolean;
  party?: "first" | "third";
  domains: string[];
  notDomains: string[];
  toDomains: string[];
  notToDomains: string[];
  methods: string[];
  notMethods: string[];
  matchCase: boolean;
  important: boolean;
  badfilter: boolean;
  redirect?: string;
  removeparam?: string;
  csp?: string;
  /** Exception-only switches: turn off generic / all cosmetic filtering on matching pages. */
  cosmeticOff?: "generic" | "all" | "specific";
  raw: string;
}

export interface CosmeticFilter {
  kind: "cosmetic";
  exception: boolean;
  domains: string[];
  notDomains: string[];
  selector: string;
  /** Needs the content script (has-text, upward, remove, style…), not plain CSS. */
  procedural: boolean;
}

export interface ScriptletFilter {
  kind: "scriptlet";
  exception: boolean;
  domains: string[];
  notDomains: string[];
  /** Canonical scriptlet name ("" with exception = turn every scriptlet off for those sites). */
  name: string;
  args: string[];
}

export type Filter = NetworkFilter | CosmeticFilter | ScriptletFilter;

const TYPE_MAP: Record<string, ResourceType[]> = {
  script: ["script"],
  image: ["image"],
  stylesheet: ["stylesheet"],
  css: ["stylesheet"],
  object: ["object"],
  "object-subrequest": ["object"],
  xmlhttprequest: ["xmlhttprequest"],
  xhr: ["xmlhttprequest"],
  subdocument: ["sub_frame"],
  frame: ["sub_frame"],
  ping: ["ping"],
  beacon: ["ping"],
  media: ["media"],
  font: ["font"],
  websocket: ["websocket"],
  other: ["other"],
};
const ALL_TYPES: ResourceType[] = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "other"];

/** Old names → the names Calmview's scriptlet engine knows. Unknown scriptlets are dropped at compile time. */
export const SCRIPTLET_ALIASES: Record<string, string> = {
  set: "set-constant",
  "trusted-set": "set-constant",
  "trusted-set-constant": "set-constant",
  aopr: "abort-on-property-read",
  aopw: "abort-on-property-write",
  acs: "abort-current-script",
  acis: "abort-current-script",
  "abort-current-inline-script": "abort-current-script",
  aeld: "addEventListener-defuser",
  "prevent-addEventListener": "addEventListener-defuser",
  nostif: "no-setTimeout-if",
  "prevent-setTimeout": "no-setTimeout-if",
  "setTimeout-defuser": "no-setTimeout-if",
  nosiif: "no-setInterval-if",
  "prevent-setInterval": "no-setInterval-if",
  "setInterval-defuser": "no-setInterval-if",
  nowoif: "no-window-open-if",
  "prevent-window-open": "no-window-open-if",
  "window.open-defuser": "no-window-open-if",
  "trusted-set-cookie": "set-cookie",
  "set-cookie-reload": "set-cookie",
  "trusted-set-local-storage-item": "set-local-storage-item",
  "trusted-set-session-storage-item": "set-session-storage-item",
  "cookie-remover": "remove-cookie",
  rmnt: "remove-node-text",
  rpnt: "replace-node-text",
  "trusted-rpnt": "replace-node-text",
  "trusted-replace-node-text": "replace-node-text",
  "prevent-xhr": "no-xhr-if",
  "trusted-prevent-xhr": "no-xhr-if",
  "prevent-fetch": "no-fetch-if",
  "trusted-prevent-fetch": "no-fetch-if",
  "nano-sib": "adjust-setInterval",
  "nano-setInterval-booster": "adjust-setInterval",
  "nano-stb": "adjust-setTimeout",
  "nano-setTimeout-booster": "adjust-setTimeout",
  rc: "remove-class",
  ra: "remove-attr",
  aost: "abort-on-stack-trace",
  "silent-noeval": "noeval",
  "prevent-eval-if": "noeval-if",
  "trusted-rpfr": "trusted-replace-fetch-response",
  "trusted-set-attr": "set-attr",
  "refresh-defuser": "prevent-refresh",
  norafif: "no-requestAnimationFrame-if",
  "prevent-requestAnimationFrame": "no-requestAnimationFrame-if",
  nobab: "bab-defuser",
  "bab-defuser": "bab-defuser",
  nofab: "fuckadblock-defuser",
  "fuckadblock.js-3.2.0": "fuckadblock-defuser",
  "popads.net": "popads-dummy",
};

const PROCEDURAL = /:(?:has-text|-abp-contains|contains|upward|remove|remove-attr|remove-class|style|matches-css(?:-before|-after)?|min-text-length|matches-path|xpath|matches-attr|matches-prop|watch-attr|others|if|if-not|-abp-has|matches-media|shadow)\(/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$|^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Parses one list line. Returns null for comments, blank lines and anything we can't honour. */
export function parseFilter(line: string): Filter | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("!") || raw.startsWith("[") || (raw.startsWith("#") && !raw.startsWith("##") && !raw.startsWith("#@#") && !raw.startsWith("#?#"))) return null;
  const cos = /^([^/"]*?)(#@?\??#|#@?\$\??#|#@?%#)(.*)$/.exec(raw);
  // "#" also appears in URLs (example.com/#anchor) but never with a / before the separator in cosmetics.
  if (cos && !cos[1].includes("/") && cos[3]) return parseCosmetic(cos[1], cos[2], cos[3]);
  return parseNetwork(raw);
}

function splitDomains(list: string, sep: string): { domains: string[]; notDomains: string[]; bad: boolean } {
  const domains: string[] = [];
  const notDomains: string[] = [];
  let bad = false;
  for (let d of list.split(sep)) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    const neg = d.startsWith("~");
    if (neg) d = d.slice(1);
    // Regex domains (/…/) aren't supported. Entities (google.*) are kept: callers expand or skip them.
    if (d.startsWith("/") || !(HOST.test(d) || /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.\*$/.test(d) || d === "localhost")) {
      if (!neg) bad = true;
      continue;
    }
    (neg ? notDomains : domains).push(d);
  }
  return { domains, notDomains, bad };
}

function parseCosmetic(prefix: string, sep: string, body: string): Filter | null {
  if (sep.includes("$") || sep.includes("%")) return null; // AdGuard CSS injection / JS: not supported
  const exception = sep.includes("@");
  const { domains, notDomains, bad } = splitDomains(prefix, ",");
  if (bad && !domains.length) return null; // only unsupported positive domains: would turn generic
  if (body.startsWith("+js(")) {
    if (!body.endsWith(")")) return null;
    const args = splitArgs(body.slice(4, -1));
    let name = (args.shift() ?? "").replace(/\.js$/, "");
    name = SCRIPTLET_ALIASES[name] ?? name;
    if (!name && !exception) return null;
    return { kind: "scriptlet", exception, domains, notDomains, name, args };
  }
  if (body.startsWith("^")) return null; // HTML filtering needs response bodies: impossible in MV3
  let selector = body.replace(/:-abp-has\(/g, ":has(").replace(/:-abp-contains\(|:contains\(/g, ":has-text(");
  if (sep.includes("?")) selector = selector.trim();
  // Braces would let a "selector" carry its own CSS rules into the page: never accept them.
  if (!selector || selector.length > 2000 || /[{}]/.test(selector.replace(/:style\([^)]*\)$/, ""))) return null;
  return { kind: "cosmetic", exception, domains, notDomains, selector, procedural: PROCEDURAL.test(selector) };
}

/** Splits scriptlet arguments: commas separate, "\," is a literal comma, quotes wrap one argument. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= s.length) {
    while (s[i] === " ") i++;
    const q = s[i];
    let arg = "";
    if ((q === "'" || q === '"' || q === "`") && s.indexOf(q, i + 1) > 0) {
      // Quoted: up to the matching unescaped quote.
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === "\\" && s[j + 1] === q) {
          arg += q;
          j++;
        } else if (s[j] === q) break;
        else arg += s[j];
      }
      i = j + 1;
      while (i < s.length && s[i] !== ",") i++;
    } else {
      for (; i < s.length; i++) {
        if (s[i] === "\\" && s[i + 1] === ",") {
          arg += ",";
          i++;
        } else if (s[i] === ",") break;
        else arg += s[i];
      }
      arg = arg.trim();
    }
    out.push(arg);
    i++;
  }
  return out;
}

/** Can Chrome's RE2 run this? (no look-around, no back-references, not absurdly long) */
export function re2Safe(re: string): boolean {
  return re.length < 400 && !/\(\?[=!<]|\\[1-9]|\(\?[a-z]*:/.test(re.replace(/\(\?:/g, "(")) && !/\\[pP]\{/.test(re);
}

function parseNetwork(raw: string): NetworkFilter | null {
  let text = raw;
  const exception = text.startsWith("@@");
  if (exception) text = text.slice(2);
  let opts = "";
  // Options start at the last "$" whose tail looks like options (regexes may contain "$").
  const at = text.lastIndexOf("$");
  if (at >= 0 && !(text.startsWith("/") && text.indexOf("/", 1) > at)) {
    const tail = text.slice(at + 1);
    if (/^~?[\w-]+(?:=.*)?$/.test(tail.split(",")[0] ?? "")) {
      opts = tail;
      text = text.slice(0, at);
    }
  }
  const f: NetworkFilter = {
    kind: "network",
    exception,
    pattern: "",
    types: [],
    notTypes: [],
    page: false,
    domains: [],
    notDomains: [],
    toDomains: [],
    notToDomains: [],
    methods: [],
    notMethods: [],
    matchCase: false,
    important: false,
    badfilter: false,
    raw,
  };
  if (opts && !applyOptions(f, opts)) return null;

  // Hosts-file lines ("0.0.0.0 example.com") and plain hostnames act like ||host^.
  const hostsLine = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(\S+)$/.exec(text);
  if (hostsLine) text = `||${hostsLine[1]}^`;

  if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) {
    const re = text.slice(1, -1);
    if (!re2Safe(re)) return null;
    f.regex = re;
  } else {
    let p = text;
    if (p === "*" || p === "|" || p === "||") p = "";
    // "*" at either end adds nothing; DNR is a substring match already.
    p = p.replace(/^\*+(?!$)/, "").replace(/(?<!^)\*+$/, "");
    if (/[^\x20-\x7e]/.test(p)) return null; // non-ASCII patterns
    if (/\s/.test(p)) return null;
    f.pattern = p;
    const m = /^\|\|([a-z0-9.-]+)\^?\|?$/i.exec(p);
    if (m && HOST.test(m[1].toLowerCase())) f.host = m[1].toLowerCase();
  }
  // "Everything" with no limits would block (or allow) the whole web.
  if (!f.pattern && !f.regex && !f.domains.length && !f.toDomains.length && !f.cosmeticOff) return null;
  return f;
}

function applyOptions(f: NetworkFilter, opts: string): boolean {
  // Commas inside regex option values (removeparam=/a,b/) are rare: split simply.
  for (let o of opts.split(",")) {
    o = o.trim();
    if (!o) continue;
    const neg = o.startsWith("~");
    if (neg) o = o.slice(1);
    const eq = o.indexOf("=");
    const name = (eq < 0 ? o : o.slice(0, eq)).toLowerCase();
    const value = eq < 0 ? "" : o.slice(eq + 1);
    if (TYPE_MAP[name]) {
      (neg ? f.notTypes : f.types).push(...TYPE_MAP[name]);
      continue;
    }
    switch (name) {
      case "document":
      case "doc":
      case "popup":
      case "popunder":
        if (neg) break; // ~document: the default already leaves pages alone
        f.page = true;
        if (name.startsWith("doc")) f.types.push("main_frame");
        else f.types.push("main_frame");
        break;
      case "all":
        f.page = true;
        f.types.push(...ALL_TYPES);
        break;
      case "third-party":
      case "3p":
      case "strict3p":
        f.party = neg ? "first" : "third";
        break;
      case "first-party":
      case "1p":
      case "strict1p":
        f.party = neg ? "third" : "first";
        break;
      case "domain":
      case "from": {
        const d = splitDomains(value, "|");
        if (d.bad && !d.domains.length) return false;
        f.domains.push(...d.domains.filter((x) => !x.endsWith(".*")));
        f.notDomains.push(...d.notDomains.filter((x) => !x.endsWith(".*")));
        // Only entities (google.*) as positives: can't express it, and dropping them would broaden it.
        if (d.domains.length && !f.domains.length) return false;
        break;
      }
      case "to": {
        const d = splitDomains(value, "|");
        if (d.bad && !d.domains.length) return false;
        f.toDomains.push(...d.domains.filter((x) => !x.endsWith(".*")));
        f.notToDomains.push(...d.notDomains.filter((x) => !x.endsWith(".*")));
        if (d.domains.length && !f.toDomains.length) return false;
        break;
      }
      case "denyallow":
        f.notToDomains.push(...splitDomains(value, "|").domains.filter((x) => !x.endsWith(".*")));
        break;
      case "method":
        for (const m of value.toLowerCase().split("|")) {
          if (m.startsWith("~")) f.notMethods.push(m.slice(1));
          else if (m) f.methods.push(m);
        }
        break;
      case "match-case":
        f.matchCase = true;
        break;
      case "important":
        f.important = true;
        break;
      case "badfilter":
        f.badfilter = true;
        break;
      case "redirect":
      case "rewrite":
        f.redirect = value.replace(/^abp-resource:/, "").replace(/:\d+$/, "");
        break;
      case "empty":
        f.redirect = "nooptext";
        break;
      case "mp4":
        f.redirect = "noopmp4-1s";
        break;
      case "removeparam":
      case "queryprune":
        f.removeparam = value;
        break;
      case "csp":
        f.csp = value;
        break;
      case "generichide":
      case "ghide":
        if (!f.exception) return false;
        f.cosmeticOff = "generic";
        break;
      case "elemhide":
      case "ehide":
        if (!f.exception) return false;
        f.cosmeticOff = "all";
        break;
      case "specifichide":
      case "shide":
        if (!f.exception) return false;
        f.cosmeticOff = "specific";
        break;
      case "reason":
      case "_":
      case "cname":
        break; // informational / no effect for us
      default:
        // redirect-rule, header, permissions, urlskip, replace, ipaddress, genericblock, webrtc, uritransform…
        // Not expressible with declarativeNetRequest: skip the whole filter rather than guess.
        return false;
    }
  }
  return true;
}
