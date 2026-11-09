// Typed settings in chrome.storage.local (this device only; never synced or sent anywhere).
import { GROUPS, type GroupId } from "./groups";

export interface Settings {
  /** Master switch. */
  enabled: boolean;
  groups: Record<GroupId, boolean>;
  /** Sites where Calmview is paused (hostnames; covers their subdomains). */
  paused: string[];
  /** Sites on lighter blocking: requests are still blocked, but nothing on the page is hidden or changed. */
  relaxed: string[];
  youtube: { skipSponsors: boolean; hideShorts: boolean };
  /** Show the number blocked on the toolbar icon. */
  badge: boolean;
  /** The user's own filters, one per line (elements hidden with the picker land here too). */
  userFilters: string;
}

export const DEFAULTS: Settings = {
  enabled: true,
  groups: Object.fromEntries(GROUPS.map((g) => [g.id, g.defaultOn])) as Record<GroupId, boolean>,
  paused: [],
  relaxed: [],
  youtube: { skipSponsors: false, hideShorts: false },
  badge: true,
  userFilters: "",
};

export function normalise(raw: Partial<Settings> | undefined): Settings {
  const s = raw ?? {};
  return {
    ...DEFAULTS,
    ...s,
    groups: { ...DEFAULTS.groups, ...(s.groups ?? {}) },
    youtube: { ...DEFAULTS.youtube, ...(s.youtube ?? {}) },
    paused: [...new Set((s.paused ?? []).map((h) => h.toLowerCase()))],
    relaxed: [...new Set((s.relaxed ?? []).map((h) => h.toLowerCase()))],
  };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  return normalise(settings as Partial<Settings> | undefined);
}

/** Read-modify-write under a lock: the popup, settings page and worker all write settings. */
export async function updateSettings(change: (s: Settings) => Settings | void): Promise<Settings> {
  return navigator.locks.request("hush-settings", async () => {
    const cur = await getSettings();
    const next = normalise(change(cur) ?? cur);
    await chrome.storage.local.set({ settings: next });
    return next;
  });
}

export const saveSettings = (patch: Partial<Settings>) => updateSettings((s) => ({ ...s, ...patch }));

/** Is `host` (or a parent domain of it) paused? Returns the paused entry. */
export function pausedEntry(s: Settings, host: string): string | undefined {
  const h = host.toLowerCase();
  return s.paused.find((p) => h === p || h.endsWith(`.${p}`));
}

/** Is `host` on lighter blocking? Returns the entry. */
export function relaxedEntry(s: Settings, host: string): string | undefined {
  const h = host.toLowerCase();
  return s.relaxed.find((p) => h === p || h.endsWith(`.${p}`));
}

/** "www.bbc.co.uk" → "bbc.co.uk"-ish: drop a leading "www." for display and pausing. */
export function siteOf(host: string): string {
  return host.toLowerCase().replace(/^www\d?\./, "");
}

/** Lines of userFilters that hide something on this site (picker results), for "Show again". */
export function siteHides(s: Settings, host: string): string[] {
  const site = siteOf(host);
  return s.userFilters
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      const i = l.indexOf("##");
      if (i <= 0 || l.includes("##+js(")) return false;
      return l
        .slice(0, i)
        .split(",")
        .some((d) => d === site || d === host || host.endsWith(`.${d}`));
    });
}
