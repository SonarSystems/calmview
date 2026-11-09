// Running totals of what Calmview blocked, kept on this device. Network blocks come from Chrome's own
// record of matched rules (declarativeNetRequest), polled once a minute; YouTube ads skipped and
// elements hidden are reported by the content script.
import type { GroupId } from "./groups";

export type Kind = "ads" | "trackers" | "threats" | "annoyances" | "skipped";

export interface Stats {
  since: number;
  total: number;
  byKind: Record<Kind, number>;
  /** "2026-11-07" → count, last 30 days. */
  days: Record<string, number>;
  /** Newest matched-rule timestamp already counted. */
  lastSeen: number;
}

export const KIND_OF_GROUP: Record<GroupId | "_dynamic" | "_session", Kind> = {
  ads: "ads",
  privacy: "trackers",
  malware: "threats",
  cookies: "annoyances",
  annoyances: "annoyances",
  _dynamic: "ads",
  _session: "ads",
};

export function emptyStats(now = Date.now()): Stats {
  return { since: now, total: 0, byKind: { ads: 0, trackers: 0, threats: 0, annoyances: 0, skipped: 0 }, days: {}, lastSeen: now };
}

export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Adds counts to stats, keeping 30 days of daily totals. */
export function addCounts(s: Stats, counts: Partial<Record<Kind, number>>, now = Date.now()): Stats {
  const next: Stats = { ...s, byKind: { ...s.byKind }, days: { ...s.days } };
  let n = 0;
  for (const [k, v] of Object.entries(counts) as [Kind, number][]) {
    if (!v) continue;
    next.byKind[k] = (next.byKind[k] ?? 0) + v;
    n += v;
  }
  next.total += n;
  const today = dayKey(now);
  next.days[today] = (next.days[today] ?? 0) + n;
  const cutoff = dayKey(now - 30 * 864e5);
  for (const d of Object.keys(next.days)) if (d < cutoff) delete next.days[d];
  return next;
}

/** Counts matched rules newer than `after`, by kind. */
export function countMatches(matches: { rule: { rulesetId: string }; timeStamp: number }[], after: number): { counts: Partial<Record<Kind, number>>; newest: number } {
  const counts: Partial<Record<Kind, number>> = {};
  let newest = after;
  for (const m of matches) {
    if (m.timeStamp <= after) continue;
    const kind = KIND_OF_GROUP[m.rule.rulesetId as GroupId] ?? "ads";
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (m.timeStamp > newest) newest = m.timeStamp;
  }
  return { counts, newest };
}

export const fmt = (n: number) => n.toLocaleString("en-GB");
