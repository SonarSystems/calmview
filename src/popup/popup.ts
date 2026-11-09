// Toolbar popup. One job: show what Calmview is doing on this site and give the few controls people
// reach for (pause here, hide something, YouTube extras). Everything else lives in Settings.
// States: loading, can't run on this page, Calmview switched off, paused here, blocking here.
import { mountPromo } from "@mono/cross-promo";
declare const __STORE__: boolean;
import { SUPPORT } from "../lib/release";
import { siteHides, updateSettings, type Settings } from "../lib/settings";
import { fmt, type Kind, type Stats } from "../lib/stats";
import { button, el, emptyState, icon, shell, toggle } from "../ui/theme";

interface TabState {
  host: string;
  site: string;
  enabled: boolean;
  paused: boolean;
  relaxed: boolean;
  counts: Partial<Record<Kind, number>>;
  youtube: boolean;
  settings: Settings;
  stats: Stats;
}

const root = document.getElementById("app")!;
const TITLE = "Calmview";
const gear = button("", () => void chrome.runtime.openOptionsPage(), "icon-btn", "Settings");
gear.append(icon("gear"));

const send = <T>(msg: unknown): Promise<T> => chrome.runtime.sendMessage(msg).catch(() => chrome.runtime.sendMessage(msg)) as Promise<T>;

function footer(stats?: Stats): string {
  if (!stats?.total) return "Everything stays in your browser.";
  const since = new Date(stats.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmt(stats.total)} ads and trackers blocked since ${since}. Nothing leaves your browser.`;
}

/** First frame: the popup's shape at once, while the worker answers. */
function drawLoading(): void {
  const body = shell(root, { title: TITLE, sub: "Checking this page…", logo: "icons/icon48.png", flat: true, actions: [gear] });
  const sk = (h: number, w = "100%") => {
    const d = el("div", "skel");
    d.style.cssText = `height:${h}px;width:${w};margin-top:12px`;
    return d;
  };
  body.append(sk(60), sk(34, "40%"), sk(22, "70%"), sk(42));
}

async function activeTabId(): Promise<number | undefined> {
  // ?tab=<id> lets the tests and store screenshots point the popup at a given tab.
  const pinned = Number(new URLSearchParams(location.search).get("tab"));
  if (pinned) return pinned;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function load(): Promise<void> {
  const tabId = await activeTabId();
  let st: TabState | undefined;
  try {
    if (tabId !== undefined) st = await send<TabState>({ type: "tab-state", tabId });
  } catch {
    st = undefined;
  }
  if (!st || tabId === undefined) return drawProblem("Calmview couldn't reach its background service. Close this and try again.");
  let page: { hidden: number; skipped: number } | null = null;
  if (st.host && st.enabled && !st.paused) page = await chrome.tabs.sendMessage(tabId, { type: "count" }, { frameId: 0 }).catch(() => null);
  draw(st, tabId, page);
}

function drawProblem(text: string): void {
  const body = shell(root, { title: TITLE, sub: "Something went wrong", logo: "icons/icon48.png", flat: true, actions: [gear] });
  body.append(emptyState("Couldn't load", text));
  body.append(button("Try again", () => void load(), "btn primary"));
}

function draw(st: TabState, tabId: number, page: { hidden: number; skipped: number } | null): void {
  const body = shell(root, { title: TITLE, sub: st.site || "This page", logo: "icons/icon48.png", flat: true, actions: [gear], footer: footer(st.stats) });

  if (!st.enabled) {
    body.append(emptyState("Calmview is switched off", "Ads, trackers and pop-ups aren't being blocked anywhere."));
    body.append(
      button("Turn Calmview on", async () => {
        await updateSettings((s) => ({ ...s, enabled: true }));
        void load();
      }, "btn primary"),
    );
    return;
  }

  if (!st.host) {
    body.append(
      emptyState("Calmview can't work on this page", "Chrome keeps its own pages and the Web Store off-limits to extensions. Calmview is still on for every website.", [
        ["shield", "Ads and trackers", "Blocked on every site, YouTube included"],
        ["target", "Hide anything", "Right-click something annoying, then Hide this element"],
        ["lock", "Private", "Your browsing stays on this device"],
      ]),
    );
    return;
  }

  // Site switch.
  const card = el("div", st.paused ? "site paused" : "site");
  const tx = el("div", "tx");
  tx.append(
    el("b", undefined, st.paused ? `Paused on ${st.site}` : st.relaxed ? `Lighter blocking on ${st.site}` : `On for ${st.site}`),
    el("span", undefined, st.paused ? "Ads and trackers will show here." : st.relaxed ? "Ads and trackers still don't load. Nothing on the page is hidden or changed." : "Ads, trackers and pop-ups are blocked."),
  );
  const sw = toggle(`Block ads on ${st.site}`, !st.paused, (on) => {
    sw.disabled = true;
    void send({ type: "set-site", host: st.host, on, tabId }).then(() => load());
  });
  card.append(icon(st.paused ? "pause" : "shield", "si"), tx, sw);
  body.append(card);
  if (st.paused) {
    body.append(el("p", "note", "Turn it back on to block ads here again. The page reloads to apply it."));
    return;
  }

  // What was blocked on this page.
  const ads = st.counts.ads ?? 0;
  const trackers = st.counts.trackers ?? 0;
  const threats = st.counts.threats ?? 0;
  const annoy = st.counts.annoyances ?? 0;
  const hidden = page?.hidden ?? 0;
  const skipped = page?.skipped ?? 0;
  const total = ads + trackers + threats + annoy + hidden + skipped;
  const count = el("div", "count");
  count.append(el("span", "big", fmt(total)), el("span", "lbl", total === 1 ? "thing blocked on this page" : "things blocked on this page"));
  body.append(count);
  const chips = el("div", "chips");
  const chip = (n: number, label: string, colour: string) => {
    if (!n) return;
    const c = el("span", "chip");
    const dot = el("i");
    dot.style.setProperty("--dot", colour);
    c.append(dot, `${fmt(n)} ${label}`);
    chips.append(c);
  };
  chip(ads, ads === 1 ? "ad request" : "ad requests", "#6366f1");
  chip(trackers, trackers === 1 ? "tracker" : "trackers", "#0e7490");
  chip(threats, threats === 1 ? "dangerous request" : "dangerous requests", "#dc2626");
  chip(annoy, "cookie notice / annoyance", "#d97706");
  chip(hidden, hidden === 1 ? "element hidden" : "elements hidden", "#64748b");
  chip(skipped, skipped === 1 ? "video ad skipped" : "video ads skipped", "#db2777");
  if (!total) chips.append(el("span", "note", "Nothing to block yet. Clean page."));
  body.append(chips);

  // Hide something.
  const pick = el("button", "action");
  pick.type = "button";
  pick.append(icon("target"), "Hide something on this page");
  pick.addEventListener("click", async () => {
    await send({ type: "pick", tabId });
    window.close();
  });
  body.append(pick);
  const hides = siteHides(st.settings, st.host);
  if (hides.length) {
    const row = el("p", "note");
    row.append(`${hides.length} ${hides.length === 1 ? "thing" : "things"} you hid on this site. `);
    const undo = el("button", "linkish", "Show again");
    undo.type = "button";
    undo.addEventListener("click", async () => {
      await send({ type: "remove-filters", lines: hides });
      await chrome.tabs.reload(tabId).catch(() => undefined);
      void load();
    });
    row.append(undo);
    body.append(row);
  }

  // Something broken? Lighter blocking first, then pausing, then telling the developer.
  body.append(brokenHelp(st, tabId));

  // YouTube extras.
  if (st.youtube) {
    body.append(el("h3", undefined, "YouTube"));
    const row = (label: string, detail: string, on: boolean, set: (on: boolean) => void) => {
      const r = el("div", "trow");
      const t = el("div", "tx");
      t.append(el("b", undefined, label), el("span", undefined, detail));
      r.append(t, toggle(label, on, set));
      body.append(r);
    };
    const saveYt = (patch: Partial<Settings["youtube"]>) => updateSettings((s) => ({ ...s, youtube: { ...s.youtube, ...patch } }));
    row("Skip sponsor segments", "Uses SponsorBlock's community list. Sends 4 characters of a hash, never the video.", st.settings.youtube.skipSponsors, (on) => void saveYt({ skipSponsors: on }).then(() => chrome.tabs.reload(tabId)));
    row("Hide Shorts", "Takes Shorts out of the home page, search and the menu.", st.settings.youtube.hideShorts, (on) => void saveYt({ hideShorts: on }).then(() => chrome.tabs.reload(tabId)));
  }
}

function brokenHelp(st: TabState, tabId: number): HTMLElement {
  const wrap = el("div");
  const relax = (on: boolean) => send({ type: "set-relaxed", host: st.host, on, tabId }).then(() => load());
  if (st.relaxed) {
    const p = el("p", "note");
    const back = el("button", "linkish", "Back to full blocking");
    back.type = "button";
    back.addEventListener("click", () => void relax(false));
    p.append("Lighter blocking is on here. ", back);
    wrap.append(p);
    return wrap;
  }
  const open = el("button", "linkish", "Something not working on this site?");
  open.type = "button";
  open.setAttribute("aria-expanded", "false");
  const box = el("div", "help");
  box.hidden = true;
  open.addEventListener("click", () => {
    box.hidden = !box.hidden;
    open.setAttribute("aria-expanded", String(!box.hidden));
  });
  const step = (title: string, text: string, action: HTMLElement) => {
    const r = el("div", "trow");
    const t = el("div", "tx");
    t.append(el("b", undefined, title), el("span", undefined, text));
    r.append(t, action);
    box.append(r);
  };
  step("1. Try lighter blocking", "Still stops ads and trackers loading, but leaves the page's layout and scripts alone. Fixes most problems.", button("Try it", () => void relax(true), "btn"));
  step("2. Pause on this site", "Turns Calmview off here only. Use the switch above.", el("span"));
  if (SUPPORT.email) {
    const subject = `Calmview: problem on ${st.site}`;
    const lines = [`Site: ${st.site}`, `Calmview ${chrome.runtime.getManifest().version}, Chrome ${/Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "?"}`, `Lists on: ${Object.entries(st.settings.groups).filter(([, v]) => v).map(([k]) => k).join(", ")}`, "", "What's wrong (what did you expect to see?):", ""];
    const a = el("a", "btn", "Email it");
    a.href = `mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
    a.target = "_blank";
    step("3. Tell us", "Opens an email with the site name and your settings (not the page address). We fix the lists for everyone.", a);
  }
  const p = el("p", "note");
  p.append(open);
  wrap.append(p, box);
  return wrap;
}

drawLoading();
void load();

// "From the maker of …": one suggestion under the popup, outside what the popup redraws.
void mountPromo({ self: "2026-11-hush", variant: "card", preview: !__STORE__ });
