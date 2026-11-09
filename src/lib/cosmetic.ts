// Works out which cosmetic filters apply to a page, from the compiled CosmeticData of every enabled
// group plus the user's own filters. Pure; the service worker turns the result into one stylesheet
// injected as a user stylesheet (pages can't override or remove it).
import { hostKeys, type CosmeticData } from "./filters/compile";

export interface PagePlan {
  /** CSS selectors to hide now (generic + site-specific). */
  hide: string[];
  /** Site-specific selectors only (cheap to count elements against). */
  specific: string[];
  /** Raw "selector:style(…)" rules → CSS declarations. */
  styles: string[];
  procedural: string[];
  /** Ask for class/id-keyed generic selectors as the page's classes and ids show up. */
  keyed: boolean;
}

export function emptyCosmetic(): CosmeticData {
  return { generic: [], keyed: {}, hide: {}, unhide: {}, procedural: {}, off: { all: [], generic: [], specific: [] } };
}

const STYLE = /^(.+?):style\((.+)\)$/;

function offFor(sets: CosmeticData[], keys: string[]): { all: boolean; generic: boolean; specific: boolean } {
  const hit = (k: "all" | "generic" | "specific") => sets.some((s) => s.off[k].some((h) => keys.includes(h)));
  return { all: hit("all"), generic: hit("generic"), specific: hit("specific") };
}

export function unhideFor(sets: CosmeticData[], keys: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) for (const k of keys) for (const sel of s.unhide[k] ?? []) out.add(sel);
  return out;
}

export function planPage(sets: CosmeticData[], hostname: string): PagePlan {
  const keys = hostKeys(hostname);
  const off = offFor(sets, keys);
  const plan: PagePlan = { hide: [], specific: [], styles: [], procedural: [], keyed: false };
  if (off.all) return plan;
  const unhide = unhideFor(sets, keys);
  if (!off.generic) {
    for (const s of sets) for (const sel of s.generic) if (!unhide.has(sel)) plan.hide.push(sel);
    plan.keyed = true;
  }
  if (!off.specific) {
    for (const s of sets) {
      for (const k of keys) {
        for (const sel of s.hide[k] ?? []) if (!unhide.has(sel)) plan.specific.push(sel);
        for (const sel of s.procedural[k] ?? []) {
          if (unhide.has(sel)) continue;
          // ":style()" on an otherwise plain selector is just CSS.
          const m = STYLE.exec(sel);
          if (m && !/:(?:has-text|upward|xpath|remove|matches-|min-text|others|watch-attr)/.test(m[1])) plan.styles.push(`${m[1]} { ${m[2]} }`);
          else plan.procedural.push(sel);
        }
      }
    }
  }
  plan.specific = [...new Set(plan.specific)];
  plan.hide.push(...plan.specific);
  plan.hide = [...new Set(plan.hide)];
  return plan;
}

/** Generic selectors keyed by ".class" / "#id" tokens that the page actually has. */
export function keyedFor(sets: CosmeticData[], hostname: string, tokens: string[]): string[] {
  const unhide = unhideFor(sets, hostKeys(hostname));
  const out = new Set<string>();
  for (const t of tokens) for (const s of sets) for (const sel of s.keyed[t] ?? []) if (!unhide.has(sel)) out.add(sel);
  return [...out];
}

/** One rule per selector: a single bad selector would otherwise void a whole grouped rule. */
export function hideCss(selectors: string[]): string {
  return selectors.map((s) => `${s}{display:none!important}`).join("\n");
}
