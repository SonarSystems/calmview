// Settings: what to block, paused sites, YouTube extras, your own filters, totals, backup.
// Redraws when settings change elsewhere (the popup), but never while you're typing in a field.
import { mountPromo } from "@mono/cross-promo";
declare const __STORE__: boolean;
import { SUPPORT } from "../lib/release";
import { compileUserFilters } from "../lib/user";
import { GROUPS } from "../lib/groups";
import { DEFAULTS, getSettings, normalise, updateSettings, type Settings } from "../lib/settings";
import { emptyStats, fmt, type Stats } from "../lib/stats";
import { button, el, ensureStyles, toggle } from "../ui/theme";

const app = document.getElementById("app")!;
const main = app.querySelector("main")!;
ensureStyles(app);

function flash(text = "Saved"): void {
  const t = document.getElementById("toast")!;
  t.textContent = text;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1600);
}

const save = async (change: (s: Settings) => Settings | void, msg = "Saved") => {
  await updateSettings(change);
  flash(msg);
};

function section(title: string, intro?: string): HTMLElement {
  const s = el("section");
  s.append(el("h2", undefined, title));
  if (intro) s.append(el("p", undefined, intro));
  return s;
}

function row(label: string, detail: string, on: boolean, set: (on: boolean) => void, opts: { id?: string; master?: boolean; disabled?: boolean } = {}): HTMLElement {
  const r = el("div", opts.master ? "trow master" : "trow");
  const t = el("div", "tx");
  t.append(el("b", undefined, label), el("span", undefined, detail));
  const sw = toggle(label, on, set, opts.disabled);
  if (opts.id) sw.id = opts.id;
  r.append(t, sw);
  return r;
}

function draw(s: Settings, stats: Stats, summary: { builtAt?: string } | null): void {
  const header = main.querySelector("header")!;
  const sub = header.querySelector(".muted")!;
  const built = summary?.builtAt ? ` · lists from ${new Date(summary.builtAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "";
  sub.textContent = `Settings · version ${chrome.runtime.getManifest().version}${built}`;
  const sections: HTMLElement[] = [];

  // Protection.
  const prot = section("What Calmview blocks");
  prot.append(row(s.enabled ? "Calmview is on" : "Calmview is off", s.enabled ? "Blocking on every site except the ones you pause." : "Nothing is blocked anywhere until you turn it back on.", s.enabled, (on) => void save((x) => ({ ...x, enabled: on }), on ? "Calmview is on" : "Calmview is off"), { id: "enabled", master: true }));
  for (const g of GROUPS) {
    prot.append(row(g.label, g.detail, s.groups[g.id], (on) => void save((x) => ({ ...x, groups: { ...x.groups, [g.id]: on } })), { id: `group-${g.id}`, disabled: !s.enabled }));
  }
  prot.append(row("Count on the toolbar button", "Shows how many requests were blocked on the current page.", s.badge, (on) => void save((x) => ({ ...x, badge: on })), { id: "badge" }));
  sections.push(prot);

  // Paused sites.
  const paused = section("Paused sites", "Calmview blocks nothing on these sites. Pause one from the Calmview button when a site doesn't work properly.");
  if (!s.paused.length) paused.append(el("div", "empty", "No paused sites."));
  else {
    const ul = el("ul", "list");
    for (const p of [...s.paused].sort()) {
      const li = el("li");
      li.append(el("span", undefined, p), button("Block ads here again", () => void save((x) => ({ ...x, paused: x.paused.filter((h) => h !== p) }), `Blocking on ${p}`), "btn"));
      ul.append(li);
    }
    paused.append(ul);
  }
  sections.push(paused);

  // YouTube.
  const yt = section("YouTube", "Video ads are blocked whenever Ads is on. These are extras.");
  yt.append(
    row("Skip sponsor segments", "Jumps over sponsor reads, self-promotion and subscribe reminders using SponsorBlock's community list. Calmview sends the first 4 characters of a hash of the video's id, never the id itself.", s.youtube.skipSponsors, (on) => void save((x) => ({ ...x, youtube: { ...x.youtube, skipSponsors: on } })), { id: "yt-sponsors" }),
    row("Hide Shorts", "Takes Shorts out of the home page, search, subscriptions and the menu.", s.youtube.hideShorts, (on) => void save((x) => ({ ...x, youtube: { ...x.youtube, hideShorts: on } })), { id: "yt-shorts" }),
  );
  sections.push(yt);

  // Your filters.
  const mine = section("Your filters", "Things you hid with “Hide something on this page” are listed here. Advanced: add filters in Adblock Plus / uBlock Origin syntax, one per line.");
  const hides = s.userFilters.split("\n").map((l) => l.trim()).filter((l) => l.includes("##") && !l.includes("##+js(") && !l.startsWith("!"));
  if (hides.length) {
    const ul = el("ul", "list");
    for (const h of hides) {
      const li = el("li");
      li.append(el("code", undefined, h), button("Remove", () => void save((x) => ({ ...x, userFilters: x.userFilters.split("\n").filter((l) => l.trim() !== h).join("\n") }), "Removed"), "btn"));
      ul.append(li);
    }
    mine.append(ul);
  }
  const ta = el("textarea");
  ta.id = "filters";
  ta.spellcheck = false;
  ta.setAttribute("aria-label", "Your filters");
  ta.placeholder = "||annoying-widget.example^\nexample.com##.newsletter-popup\n@@||site-i-trust.example^";
  ta.value = s.userFilters;
  const status = el("div");
  const showProblems = () => {
    const c = compileUserFilters(ta.value);
    status.replaceChildren();
    status.append(el("p", "note", `${fmt(c.count)} ${c.count === 1 ? "filter" : "filters"} in use.`));
    if (c.problems.length) {
      const ul = el("ul", "problems");
      for (const p of c.problems.slice(0, 20)) {
        const li = el("li");
        li.append(el("code", undefined, p.line), ` — ${p.why}`);
        ul.append(li);
      }
      status.append(ul);
    }
  };
  const btns = el("div", "btns");
  const saveBtn = button("Save filters", () => void save((x) => ({ ...x, userFilters: ta.value }), "Filters saved").then(showProblems), "btn primary");
  btns.append(saveBtn);
  mine.append(ta, btns, status);
  showProblems();
  sections.push(mine);

  // Totals.
  const tot = section("Blocked so far", `Since ${new Date(stats.since).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, on this device.`);
  const nums = el("div", "nums");
  const num = (n: number, label: string) => {
    const d = el("div", "num");
    d.append(el("b", undefined, fmt(n)), el("span", undefined, label));
    nums.append(d);
  };
  const week = Object.entries(stats.days)
    .filter(([d]) => d >= new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10))
    .reduce((n, [, v]) => n + v, 0);
  num(stats.total, "in total");
  num(week, "in the last 7 days");
  num(stats.byKind.ads, "ad requests");
  num(stats.byKind.trackers, "trackers");
  num(stats.byKind.threats, "dangerous requests");
  num(stats.byKind.annoyances, "cookie notices and annoyances");
  num(stats.byKind.skipped, "video ads skipped");
  tot.append(nums);
  sections.push(tot);

  // Backup.
  const backup = section("Backup", "Move your settings, paused sites and filters to another computer.");
  const file = el("input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.hidden = true;
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as { hush?: number; settings?: Partial<Settings> };
      if (!data.settings || data.hush !== 1) throw new Error("not a Calmview backup");
      await save(() => normalise(data.settings), "Settings imported");
    } catch {
      flash("That file isn't a Calmview backup");
    }
    file.value = "";
  });
  const bb = el("div", "btns");
  bb.append(
    button("Export settings", async () => {
      const blob = new Blob([JSON.stringify({ hush: 1, exportedAt: new Date().toISOString(), settings: await getSettings() }, null, 2)], { type: "application/json" });
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hush-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "btn"),
    button("Import settings", () => file.click(), "btn"),
    button("Reset everything", () => {
      if (confirm("Reset Calmview to its defaults? Paused sites and your filters will be removed.")) void save(() => ({ ...DEFAULTS }), "Reset to defaults");
    }, "btn"),
    file,
  );
  backup.append(bb);
  sections.push(backup);

  // Privacy.
  const priv = section("Privacy");
  priv.append(
    el("p", undefined, "Calmview does its blocking inside Chrome. It has no account, no server and no analytics, and it never sees what you type."),
    el("p", undefined, s.youtube.skipSponsors ? "Leaves your browser: only the SponsorBlock lookup described above, while Skip sponsor segments is on." : "Nothing leaves your browser. (Skip sponsor segments, if you turn it on, asks SponsorBlock about videos you watch, using a 4-character hash prefix.)"),
    el("p", undefined, "Filter lists: EasyList, EasyPrivacy, uBlock Origin filters, Fanboy's lists and URLhaus, compiled into Calmview when it's built."),
  );
  const lic = el("p");
  lic.append("Calmview is free software under the GNU GPL v3, built on volunteer-run filter lists. ");
  if (SUPPORT.source) {
    const a = el("a", undefined, "Source code and credits");
    a.href = SUPPORT.source;
    a.target = "_blank";
    a.rel = "noopener";
    a.style.color = "var(--brand)";
    lic.append(a);
  } else {
    const a = el("a", undefined, "Credits");
    a.href = chrome.runtime.getURL("CREDITS.md");
    a.target = "_blank";
    a.style.color = "var(--brand)";
    lic.append(a);
  }
  priv.append(lic);
  if (SUPPORT.email) priv.append(el("p", undefined, `Questions or a site that doesn't work: ${SUPPORT.email}`));
  sections.push(priv);

  main.replaceChildren(header, ...sections);
}

let summary: { builtAt?: string } | null = null;

async function refresh(): Promise<void> {
  // Never redraw under someone typing.
  if (document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) return;
  const [s, { stats }] = await Promise.all([getSettings(), chrome.storage.local.get("stats") as Promise<{ stats?: Stats }>]);
  draw(s, stats ?? emptyStats(), summary);
}

chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && (c.settings || c.stats)) void refresh();
});

async function init(): Promise<void> {
  summary = await fetch(chrome.runtime.getURL("data/summary.json")).then((r) => r.json(), () => null);
  await refresh();
}
void init();

// "More from the maker": one more card at the end of Settings, in the page's own column. Pages
// that redraw their column (main.replaceChildren) drop it, so it's put back each time.
{
  const main = document.querySelector("main") ?? document.body;
  const wrap = document.createElement("section");
  wrap.className = "cross-promo";
  // Hidden until the page has drawn its own sections (or 400 ms), so it never flashes first.
  wrap.hidden = true;
  const reveal = () => (wrap.hidden = false);
  setTimeout(reveal, 400);
  main.append(wrap);
  const keep = new MutationObserver(() => {
    if (!wrap.isConnected) main.append(wrap);
    reveal();
  });
  keep.observe(main, { childList: true });
  void mountPromo({ self: "2026-11-hush", variant: "grid", parent: wrap, preview: !__STORE__ }).then((el) => {
    if (!el) {
      keep.disconnect();
      wrap.remove();
    }
  });
}
