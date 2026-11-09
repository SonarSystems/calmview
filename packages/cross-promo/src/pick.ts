// Which of the maker's other extensions to suggest, and where the button goes. Pure, so it's tested
// without a browser.

export interface Item {
  key: string;
  name: string;
  title: string;
  summary: string;
  icon: string | null;
  storeId: string | null;
  storeUrl: string | null;
  rating: number | null;
  ratings: string | null;
  users: number | null;
  tags: string[];
}

export interface Catalogue {
  maker: string;
  refreshedAt: string;
  items: Item[];
}

export interface PromoState {
  /** When this extension first showed (or tried to show) a suggestion. */
  firstSeen: number;
  /** key → when it was dismissed. */
  dismissed: Record<string, number>;
  /** "Don't show suggestions". */
  off: boolean;
}

export const DISMISS_DAYS = 60;
const DAY = 864e5;

/** Suggestions in order: not this extension, published (or any, in preview builds), not installed or
 *  dismissed; extensions sharing a tag with this one first; the rest rotate daily. */
export function ranked(cat: Catalogue, self: string, opts: { preview?: boolean; installed?: Set<string>; state?: PromoState; now?: number } = {}): Item[] {
  const now = opts.now ?? Date.now();
  const me = cat.items.find((i) => i.key === self);
  const myTags = new Set(me?.tags ?? []);
  const list = cat.items.filter((i) => {
    if (i.key === self) return false;
    if (!i.storeUrl && !opts.preview) return false;
    if (i.storeId && opts.installed?.has(i.storeId)) return false;
    const d = opts.state?.dismissed[i.key];
    return !(d && now - d < DISMISS_DAYS * DAY);
  });
  const day = Math.floor(now / DAY);
  const shared = (i: Item) => i.tags.filter((t) => myTags.has(t)).length;
  // Stable daily rotation: offset by the day number, so the card changes from day to day.
  const rot = (i: Item) => (cat.items.indexOf(i) + day) % Math.max(1, cat.items.length);
  return list.sort((a, b) => shared(b) - shared(a) || rot(a) - rot(b));
}

/** The one card for a popup, or null while it's too soon after install, or switched off. */
export function pickOne(cat: Catalogue, self: string, state: PromoState, opts: { preview?: boolean; installed?: Set<string>; now?: number; minDays?: number } = {}): Item | null {
  const now = opts.now ?? Date.now();
  if (state.off) return null;
  // Let people get to know the extension before suggesting another.
  if (now - state.firstSeen < (opts.minDays ?? 2) * DAY) return null;
  const list = ranked(cat, self, { ...opts, state, now });
  if (!list.length) return null;
  // Among equally relevant suggestions, today's rotation decides.
  return list[0];
}

/** Store link tagged so the Web Store dashboard shows which extension sent the visit. */
export function ctaUrl(item: Item, self: string, placement: "popup" | "settings"): string {
  const base = item.storeUrl ?? `https://chromewebstore.google.com/search/${encodeURIComponent(item.title)}`;
  const u = new URL(base);
  u.searchParams.set("utm_source", self.replace(/^\d{4}-\d{2}-/, ""));
  u.searchParams.set("utm_medium", "extension");
  u.searchParams.set("utm_campaign", `cross-promo-${placement}`);
  return u.toString();
}

/** "4.8 ★ · 12k users", or a plain "Free" before there are ratings to show. */
export function metaLine(item: Item): string {
  const parts: string[] = [];
  if (item.rating) parts.push(`${item.rating.toFixed(1)} ★`);
  if (item.users && item.users >= 100) parts.push(`${compact(item.users)} users`);
  parts.push("Free");
  return parts.join(" · ");
}

export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}
