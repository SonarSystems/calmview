// "My filters": the user's own lines (including elements hidden with the picker), compiled at run
// time into dynamic network rules and cosmetic data. Scriptlets aren't allowed here: they run code
// in pages, so they only come from the lists Calmview ships.
import { emptyCosmetic } from "./cosmetic";
import { mergeRules, networkRule, PRIORITY, selectorKey, type CosmeticData } from "./filters/compile";
import { parseFilter } from "./filters/parse";

export interface UserCompiled {
  rules: Omit<chrome.declarativeNetRequest.Rule, "id">[];
  cosmetic: CosmeticData;
  count: number;
  /** Lines Calmview couldn't use, with why. */
  problems: { line: string; why: string }[];
}

/** Chrome allows 5,000 dynamic rules that aren't "safe" (block/redirect); stay well inside. */
const MAX_RULES = 4500;

export function compileUserFilters(text: string): UserCompiled {
  const out: UserCompiled = { rules: [], cosmetic: emptyCosmetic(), count: 0, problems: [] };
  const push = (map: Record<string, string[]>, k: string, v: string) => void (map[k] ??= []).push(v);
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (!raw || raw.startsWith("!")) continue;
    const f = parseFilter(raw);
    if (!f) {
      out.problems.push({ line: raw, why: "Calmview doesn't understand this filter" });
      continue;
    }
    if (f.kind === "scriptlet") {
      out.problems.push({ line: raw, why: "Scripts (+js) only run from the built-in lists" });
      continue;
    }
    out.count++;
    if (f.kind === "cosmetic") {
      const c = out.cosmetic;
      if (f.exception) {
        for (const d of f.domains.length ? f.domains : []) push(c.unhide, d, f.selector);
      } else if (f.procedural) {
        if (!f.domains.length) out.problems.push({ line: raw, why: "Special selectors need a site in front (example.com##…)" });
        for (const d of f.domains) push(c.procedural, d, f.selector);
      } else if (!f.domains.length) {
        const key = selectorKey(f.selector);
        if (key) push(c.keyed, key, f.selector);
        else c.generic.push(f.selector);
      } else for (const d of f.domains) push(c.hide, d, f.selector);
      for (const d of f.notDomains) push(c.unhide, d, f.selector);
      continue;
    }
    if (f.cosmeticOff) {
      if (f.host) out.cosmetic.off[f.cosmeticOff].push(f.host);
      continue;
    }
    const r = networkRule(f, { block: PRIORITY.userBlock, allow: PRIORITY.userAllow });
    if (!r) {
      out.problems.push({ line: raw, why: "Uses an option Chrome's blocking engine can't do" });
      out.count--;
      continue;
    }
    // Whole pages: a blocked site you type in should still be blocked, not just its parts.
    if (f.page && f.host && !f.exception) r.condition.resourceTypes = [...new Set([...(r.condition.resourceTypes ?? []), "main_frame" as const])];
    out.rules.push(r);
  }
  out.rules = mergeRules(out.rules).slice(0, MAX_RULES);
  return out;
}
