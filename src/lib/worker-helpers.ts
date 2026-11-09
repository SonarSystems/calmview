// Small worker helpers: match patterns for registered scripts, and SponsorBlock lookups.

/** Common endings for entity filters ("google.*"), which match patterns can't express. */
const ENTITY_TLDS = ["com", "co.uk", "uk", "de", "fr", "es", "it", "nl", "pl", "ru", "com.br", "com.au", "ca", "in", "jp", "co", "io", "net", "org", "to", "cc", "me", "tv", "info", "xyz", "se", "ch", "at", "be", "pt", "cz", "ro", "hu", "gr", "tr", "ie", "lol", "si", "sx", "ws", "la", "nu", "is"];

/** Hostnames (and entities) → "*://*.host/*" patterns. Anything odd is dropped, never passed on. */
export function matchPatterns(hosts: string[]): string[] {
  const out = new Set<string>();
  for (const h of hosts) {
    const host = h.toLowerCase();
    const names = host.endsWith(".*") ? ENTITY_TLDS.map((t) => host.slice(0, -1) + t) : [host];
    for (const n of names) {
      if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(n) || n.includes("..")) continue;
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(n)) out.add(`*://${n}/*`);
      else out.add(`*://*.${n}/*`);
    }
  }
  return [...out];
}

export interface Segment {
  start: number;
  end: number;
  category: string;
}

const SB_DEFAULT = "https://sponsor.ajay.app";
const CATEGORIES = ["sponsor", "selfpromo", "interaction"];
const sbCache = new Map<string, Promise<Segment[]>>();

/**
 * Sponsor segments for a video from SponsorBlock's community database. Privacy: only the first four
 * characters of the video id's SHA-256 hash are sent, so the server can't tell which video it is.
 */
export function sponsorSegments(videoId: string, base = SB_DEFAULT): Promise<Segment[]> {
  if (!/^[\w-]{6,20}$/.test(videoId)) return Promise.resolve([]);
  const key = `${base}|${videoId}`;
  let p = sbCache.get(key);
  if (!p) {
    p = (async () => {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(videoId))))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const url = `${base}/api/skipSegments/${hash.slice(0, 4)}?categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}`;
      const res = await fetch(url, { credentials: "omit" });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`SponsorBlock ${res.status}`);
      const list = (await res.json()) as { videoID: string; segments: { segment: [number, number]; category: string; actionType?: string }[] }[];
      const entry = list.find((v) => v.videoID === videoId);
      return (entry?.segments ?? [])
        .filter((s) => (s.actionType ?? "skip") === "skip" && s.segment[1] > s.segment[0])
        .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category }))
        .sort((a, b) => a.start - b.start);
    })();
    p.catch(() => sbCache.delete(key));
    sbCache.set(key, p);
    if (sbCache.size > 200) sbCache.delete(sbCache.keys().next().value!);
  }
  return p.catch(() => []);
}
