// "From the maker of …": suggests the maker's other extensions inside an extension's own pages (never
// on websites). Two looks: one card for the popup and a grid for Settings. Rendered in a shadow root
// with its own light and dark styles, so it looks the same in every extension and nothing leaks.
//
//   import { mountPromo } from "@mono/cross-promo";
//   mountPromo({ self: "2026-11-hush", variant: "card", preview: !__STORE__ });           // popup
//   mountPromo({ self: "2026-11-hush", variant: "grid", parent: el, preview: !__STORE__ }); // settings
//   // service worker: import { listenForPromoPings } from "@mono/cross-promo/background";
//
// Guardrails: quiet (one card, never animated in, only two days after install), every card can be
// dismissed and the whole thing switched off, extensions already installed are skipped, and nothing
// is sent anywhere: the catalogue is bundled at build time.
import catalogueJson from "./catalogue.json";
import { ctaUrl, metaLine, pickOne, ranked, type Catalogue, type Item, type PromoState } from "./pick";

export { ctaUrl, metaLine, pickOne, ranked, type Catalogue, type Item, type PromoState } from "./pick";
export const catalogue = catalogueJson as Catalogue;

const KEY = "crossPromo";

export async function getPromoState(): Promise<PromoState> {
  const got = (await chrome.storage.local.get(KEY))[KEY] as Partial<PromoState> | undefined;
  const state: PromoState = { firstSeen: got?.firstSeen ?? Date.now(), dismissed: got?.dismissed ?? {}, off: got?.off ?? false };
  if (!got?.firstSeen) await chrome.storage.local.set({ [KEY]: state });
  return state;
}

async function savePromoState(change: (s: PromoState) => void): Promise<void> {
  const s = await getPromoState();
  change(s);
  await chrome.storage.local.set({ [KEY]: s });
}

export const setPromoOff = (off: boolean) => savePromoState((s) => void (s.off = off));

/** Store ids of the maker's extensions installed in this browser (each answers a ping). */
export async function installedIds(items: Item[]): Promise<Set<string>> {
  const ids = items.map((i) => i.storeId).filter((id): id is string => !!id && id !== chrome.runtime.id);
  const cacheKey = "crossPromoInstalled";
  try {
    const cached = (await chrome.storage.session.get(cacheKey))[cacheKey] as string[] | undefined;
    if (cached) return new Set(cached);
  } catch {
    /* session storage not available here */
  }
  const ping = (id: string) =>
    Promise.race([
      chrome.runtime.sendMessage(id, { type: "cross-promo:ping" }).then((r) => !!r?.ok, () => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), 400)),
    ]);
  const found = (await Promise.all(ids.map(async (id) => ((await ping(id)) ? id : null)))).filter((x): x is string => !!x);
  try {
    await chrome.storage.session.set({ [cacheKey]: found });
  } catch {
    /* ignore */
  }
  return new Set(found);
}

const CSS = `
:host { all: initial; display: block; }
.w { --ink:#0f172a; --muted:#5b6577; --line:#e2e8f0; --bg:#ffffff; --soft:#f8fafc; --brand:#4338ca; --on-brand:#ffffff; --ring:rgba(67,56,202,.35);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased; }
@media (prefers-color-scheme: dark) { .w { --ink:#e2e8f0; --muted:#94a3b8; --line:#334155; --bg:#0f172a; --soft:#1e293b; --brand:#a5b4fc; --on-brand:#0f172a; --ring:rgba(165,180,252,.4); } }
.w * { box-sizing: border-box; }
.card { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; grid-template-areas: "eb eb eb" "ic tx cta"; column-gap: 12px; row-gap: 8px; align-items: center;
  margin: 10px 12px 12px; padding: 10px 12px 12px; border-radius: 14px; background: var(--soft); border: 1px solid var(--line); transition: border-color .15s, box-shadow .15s; }
.card .eyebrow { grid-area: eb; } .card .ic { grid-area: ic; } .card .tx { grid-area: tx; } .card .cta { grid-area: cta; }
.card:hover { border-color: var(--brand); box-shadow: 0 6px 20px -10px var(--ring); }
.ic { width: 40px; height: 40px; flex: none; border-radius: 10px; display: block; }
.tx { flex: 1; min-width: 0; }
.eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0 0 2px; padding-right: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nm { font-weight: 700; font-size: 14px; }
.sm { color: var(--ink); opacity: .85; font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 1px; }
.mt { color: var(--muted); font-size: 11.5px; margin-top: 3px; }
.cta { all: unset; box-sizing: border-box; flex: none; cursor: pointer; background: var(--brand); color: var(--on-brand); font-weight: 700; font-size: 12.5px; padding: 7px 12px; border-radius: 999px; white-space: nowrap; }
.cta:hover { filter: brightness(1.08); }
.cta:focus-visible, .x:focus-visible, .lnk:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.x { all: unset; position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; color: var(--muted); cursor: pointer; }
.x:hover { background: var(--line); color: var(--ink); }
.x svg { width: 12px; height: 12px; }
.grid-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; }
.grid-head h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.grid-head .sp { flex: 1; }
.lnk { all: unset; cursor: pointer; color: var(--brand); font-weight: 600; font-size: 12.5px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.tile { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 14px; background: var(--bg); border: 1px solid var(--line); transition: border-color .15s, box-shadow .15s; }
.tile:hover { border-color: var(--brand); box-shadow: 0 8px 24px -14px var(--ring); }
.tile .top { display: flex; gap: 10px; align-items: center; }
.tile .ic { width: 44px; height: 44px; border-radius: 11px; }
.tile .sm { -webkit-line-clamp: 3; flex: 1; }
.tile .row { display: flex; align-items: center; gap: 8px; margin-top: auto; }
.tile .row .mt { flex: 1; margin: 0; }
.off { color: var(--muted); font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .card, .tile { transition: none; } }
`;

const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function shadowHost(parent: HTMLElement): { host: HTMLElement; root: HTMLElement } {
  const host = document.createElement("cross-promo");
  const shadow = host.attachShadow({ mode: "open" });
  const style = h("style");
  style.textContent = CSS;
  const root = h("div", "w");
  shadow.append(style, root);
  parent.append(host);
  return { host, root };
}

function icon(item: Item, size: number): HTMLElement {
  const img = h("img", "ic");
  img.alt = "";
  img.width = img.height = size;
  if (item.icon) img.src = item.icon;
  return img;
}

function cta(item: Item, self: string, placement: "popup" | "settings"): HTMLAnchorElement {
  const a = h("a", "cta", "Add to Chrome");
  a.href = ctaUrl(item, self, placement);
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute("aria-label", `Add ${item.name} to Chrome (opens the Chrome Web Store)`);
  return a;
}

export interface MountOptions {
  /** This extension's folder name in experiments/ (so it never suggests itself). */
  self: string;
  variant: "card" | "grid";
  /** Where to put it. Default for the card: the end of <body>, outside anything the page redraws. */
  parent?: HTMLElement;
  /** Development builds: also suggest extensions that aren't on the store yet (button opens a store search). */
  preview?: boolean;
  /** Days after install before the popup card first appears (default 2; 0 in preview). */
  minDays?: number;
}

/** Shows the card or grid. Resolves to the element added, or null when there's nothing to show. */
export async function mountPromo(opts: MountOptions): Promise<HTMLElement | null> {
  try {
    const cat = catalogue;
    const me = cat.items.find((i) => i.key === opts.self);
    const state = await getPromoState();
    const installed = await installedIds(cat.items);
    if (opts.variant === "card") {
      const item = pickOne(cat, opts.self, state, { preview: opts.preview, installed, minDays: opts.minDays ?? (opts.preview ? 0 : 2) });
      if (!item) return null;
      const { host, root } = shadowHost(opts.parent ?? document.body);
      const card = h("div", "card");
      card.setAttribute("role", "complementary");
      card.setAttribute("aria-label", `Suggestion: ${item.name}`);
      const tx = h("div", "tx");
      tx.append(h("div", "nm", item.name), h("div", "sm", item.summary), h("div", "mt", metaLine(item)));
      const x = h("button", "x");
      x.type = "button";
      x.title = "Not interested";
      x.setAttribute("aria-label", `Hide the ${item.name} suggestion`);
      x.innerHTML = X_ICON; // constant
      x.addEventListener("click", async () => {
        await savePromoState((s) => void (s.dismissed[item.key] = Date.now()));
        host.remove();
      });
      card.append(h("div", "eyebrow", `From the maker of ${me?.name ?? "this extension"}`), icon(item, 40), tx, cta(item, opts.self, "popup"), x);
      root.append(card);
      return host;
    }

    // Grid for Settings: everything relevant, plus the switch for the popup card.
    const items = ranked(cat, opts.self, { preview: opts.preview, installed, state: { ...state, dismissed: {} } });
    if (!items.length) return null;
    const { host, root } = shadowHost(opts.parent ?? document.body);
    const draw = (off: boolean) => {
      root.replaceChildren();
      const head = h("div", "grid-head");
      const toggle = h("button", "lnk", off ? "Show suggestions in the menu" : "Don't suggest these in the menu");
      toggle.type = "button";
      toggle.addEventListener("click", async () => {
        await setPromoOff(!off);
        draw(!off);
      });
      head.append(h("h2", undefined, `More from ${cat.maker}`), h("span", "sp"), toggle);
      root.append(head);
      const grid = h("div", "grid");
      for (const item of items) {
        const t = h("div", "tile");
        const top = h("div", "top");
        const nm = h("div");
        nm.append(h("div", "nm", item.name), h("div", "mt", metaLine(item)));
        top.append(icon(item, 44), nm);
        const row = h("div", "row");
        row.append(h("div", "mt", item.tags.length ? item.tags.slice(0, 2).map((x) => x[0].toUpperCase() + x.slice(1)).join(" · ") : ""), cta(item, opts.self, "settings"));
        t.append(top, h("div", "sm", item.summary), row);
        grid.append(t);
      }
      root.append(grid);
    };
    draw(state.off);
    return host;
  } catch {
    // A suggestion must never break the page it's on.
    return null;
  }
}
