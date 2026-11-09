// Downloads the filter lists Calmview is built from into lists/ (git-ignored; ~20 MB).
//   node scripts/update-lists.mjs          -> refresh every list
//   node scripts/update-lists.mjs --missing -> only fetch lists that aren't there yet (build uses this)
// Each list is checked to look like a filter list before it replaces the old copy, so a captive
// portal or an error page never ends up compiled into the extension.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LISTS = {
  easylist: "https://easylist.to/easylist/easylist.txt",
  easyprivacy: "https://easylist.to/easylist/easyprivacy.txt",
  "ubo-filters": "https://ublockorigin.github.io/uAssets/filters/filters.txt",
  "ubo-quickfixes": "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
  "ubo-unbreak": "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
  "ubo-privacy": "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
  "ubo-badware": "https://ublockorigin.github.io/uAssets/filters/badware.txt",
  cookies: "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
  annoyances: "https://secure.fanboy.co.nz/fanboy-annoyance.txt",
  urlhaus: "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-ag-online.txt",
};

const dir = join(root, "lists");
mkdirSync(dir, { recursive: true });
const onlyMissing = process.argv.includes("--missing");
let failed = 0;
await Promise.all(
  Object.entries(LISTS).map(async ([name, url]) => {
    const file = join(dir, `${name}.txt`);
    if (onlyMissing && existsSync(file) && statSync(file).size > 1000) return;
    try {
      const res = await fetch(url, { headers: { "user-agent": "Calmview filter list updater" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split("\n").filter((l) => l && !l.startsWith("!"));
      if (lines.length < 50 || /<html/i.test(text.slice(0, 500))) throw new Error("doesn't look like a filter list");
      writeFileSync(file, text);
      console.log(`${name}: ${lines.length} filters`);
    } catch (e) {
      failed++;
      console.error(`${name}: ${e.message} (${existsSync(file) ? "kept the old copy" : "MISSING"})`);
    }
  }),
);
if (failed && Object.keys(LISTS).some((n) => !existsSync(join(dir, `${n}.txt`)))) process.exit(1);
