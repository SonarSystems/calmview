// YouTube, page world (MAIN), document_start. Calmview's own layer on top of the filter lists: takes ad
// slots out of the player's data before the player reads it, wherever that data arrives from:
// the inline ytInitialPlayerResponse / ytInitialData, JSON.parse, fetch() and XHR responses.
// The isolated-world half (src/content/youtube.ts) catches whatever still gets through and skips it.
import { prune } from "./scriptlets";

const AD_KEYS = "adPlacements adSlots playerAds adBreakHeartbeatParams";
const PATHS = [
  AD_KEYS,
  "playerResponse.adPlacements playerResponse.adSlots playerResponse.playerAds playerResponse.adBreakHeartbeatParams",
  "[].playerResponse.adPlacements [].playerResponse.adSlots [].playerResponse.playerAds",
  // Shorts feed ads and in-feed promoted items.
  "entries.[-].command.reelWatchEndpoint.adClientParams.isAd",
].join(" ");

/** Removes ad slots and in-feed ad items from any YouTube JSON object. Returns true if it changed. */
export function stripAds(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  let changed = prune(obj, PATHS);
  changed = dropAdItems(obj, 0) || changed;
  return changed;
}

/** In-feed ads are list items wrapping an adSlotRenderer; remove those items from their arrays. */
function dropAdItems(o: unknown, depth: number): boolean {
  if (!o || typeof o !== "object" || depth > 14) return false;
  let changed = false;
  if (Array.isArray(o)) {
    for (let i = o.length - 1; i >= 0; i--) {
      const item = o[i] as Record<string, unknown> | null;
      if (item && typeof item === "object" && isAdItem(item)) {
        o.splice(i, 1);
        changed = true;
      } else if (dropAdItems(item, depth + 1)) changed = true;
    }
    return changed;
  }
  for (const v of Object.values(o as Record<string, unknown>)) if (v && typeof v === "object" && dropAdItems(v, depth + 1)) changed = true;
  return changed;
}

function isAdItem(item: Record<string, unknown>): boolean {
  if ("adSlotRenderer" in item || "promotedSparklesWebRenderer" in item || "searchPyvRenderer" in item) return true;
  const rich = item.richItemRenderer as { content?: Record<string, unknown> } | undefined;
  if (rich?.content && "adSlotRenderer" in rich.content) return true;
  const section = item.richSectionRenderer as { content?: Record<string, unknown> } | undefined;
  return !!section?.content && ("statementBannerRenderer" in section.content || "brandVideoShelfRenderer" in section.content);
}

const AD_URL = /\/youtubei\/v1\/(?:player|next|browse|search|reel\/reel_watch_sequence|get_watch)|\/watch\?|\/playlist\?/;

export function installYouTube(): void {
  const W = window as unknown as Record<string, unknown>;
  // 1. The inline globals the first page load is built from.
  for (const name of ["ytInitialPlayerResponse", "ytInitialData", "ytInitialReelWatchSequenceResponse"]) {
    let value: unknown = W[name];
    if (value) stripAds(value);
    try {
      Object.defineProperty(W, name, {
        configurable: true,
        get: () => value,
        set(v) {
          try {
            stripAds(v);
          } catch {
            /* keep the page working */
          }
          value = v;
        },
      });
    } catch {
      /* already locked */
    }
  }

  // 2. JSON.parse: player responses embedded as strings in later scripts.
  const parse = JSON.parse;
  JSON.parse = new Proxy(parse, {
    apply(t, self, args) {
      const obj = Reflect.apply(t, self, args);
      try {
        if (typeof args[0] === "string" && args[0].length > 200 && /"(?:adPlacements|adSlots|playerAds|adSlotRenderer)"/.test(args[0])) stripAds(obj);
      } catch {
        /* ignore */
      }
      return obj;
    },
  });

  // 3. fetch() and Response.json(): navigation inside the single-page app.
  const json = Response.prototype.json;
  Response.prototype.json = new Proxy(json, {
    apply(t, self: Response, args) {
      return (Reflect.apply(t, self, args) as Promise<unknown>).then((obj) => {
        try {
          if (AD_URL.test(self.url)) stripAds(obj);
        } catch {
          /* ignore */
        }
        return obj;
      });
    },
  });
  const text = Response.prototype.text;
  Response.prototype.text = new Proxy(text, {
    apply(t, self: Response, args) {
      return (Reflect.apply(t, self, args) as Promise<string>).then((body) => {
        try {
          if (AD_URL.test(self.url) && /"(?:adPlacements|adSlots|playerAds|adSlotRenderer)"/.test(body)) {
            const obj = JSON.parse(body.replace(/^\)\]\}'\n?/, ""));
            if (stripAds(obj)) return JSON.stringify(obj);
          }
        } catch {
          /* not JSON */
        }
        return body;
      });
    },
  });

  // 4. XHR (older player builds and the embedded player).
  const proto = XMLHttpRequest.prototype;
  const urls = new WeakMap<XMLHttpRequest, string>();
  const open = proto.open;
  proto.open = new Proxy(open, {
    apply(t, self: XMLHttpRequest, args) {
      urls.set(self, String(args[1]));
      return Reflect.apply(t, self, args);
    },
  });
  for (const prop of ["responseText", "response"] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc?.get) continue;
    const getter = desc.get;
    const cache = new WeakMap<XMLHttpRequest, [unknown, unknown]>();
    Object.defineProperty(proto, prop, {
      ...desc,
      get: new Proxy(getter, {
        apply(t, self: XMLHttpRequest, a) {
          const v = Reflect.apply(t, self, a);
          try {
            if (self.readyState !== 4 || !AD_URL.test(urls.get(self) ?? "")) return v;
            const c = cache.get(self);
            if (c && c[0] === v) return c[1];
            let out = v;
            if (typeof v === "string" && /"(?:adPlacements|adSlots|playerAds)"/.test(v)) {
              const obj = JSON.parse(v);
              if (stripAds(obj)) out = JSON.stringify(obj);
            } else if (v && typeof v === "object") stripAds(v);
            cache.set(self, [v, out]);
            return out;
          } catch {
            return v;
          }
        },
      }),
    });
  }
}
