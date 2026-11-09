// Build step (bundled and run by scripts/build.mjs): compiles lists/*.txt into
//   <out>/rules/<group>.json        static declarativeNetRequest rulesets (declared in the manifest)
//   <out>/data/<group>.json         cosmetic index, hosts for the blocked page, scriptlet hosts
//   <out>/data/<group>.scriptlets.json  per-site scriptlet calls (wrapped into MAIN-world scripts)
// and returns a summary the build prints and writes to <out>/data/summary.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectBadfilters, compileGroup } from "../lib/filters/compile";
import { GROUPS, type GroupId } from "../lib/groups";

export function compileLists(listsDir: string, out: string): Record<GroupId, unknown> {
  mkdirSync(join(out, "rules"), { recursive: true });
  mkdirSync(join(out, "data"), { recursive: true });
  const read = (name: string) => {
    const file = join(listsDir, `${name}.txt`);
    if (!existsSync(file)) throw new Error(`lists/${name}.txt is missing: run \`pnpm update-lists\`.`);
    const text = readFileSync(file, "utf8");
    // URLhaus is mostly single malware file URLs (~95k): far beyond Chrome's rule budget. Keep its
    // whole-host entries, which cover the sites that exist only to spread malware.
    if (name === "urlhaus") return text.split("\n").filter((l) => /^\|\|[^/]+\^\$all$/.test(l.trim())).join("\n");
    return text;
  };
  const all = GROUPS.flatMap((g) => g.lists.map(read));
  const badfilters = collectBadfilters(all);
  const summary = {} as Record<GroupId, unknown>;
  for (const g of GROUPS) {
    const res = compileGroup(g.lists.map(read), { badfilters });
    writeFileSync(join(out, "rules", `${g.id}.json`), JSON.stringify(res.rules));
    const scriptletHosts = Object.keys(res.scriptlets.run);
    writeFileSync(join(out, "data", `${g.id}.json`), JSON.stringify({ pageBlocks: res.pageBlocks, cosmetic: res.cosmetic, scriptletHosts }));
    writeFileSync(join(out, "data", `${g.id}.scriptlets.json`), JSON.stringify(res.scriptlets));
    summary[g.id] = { ...res.stats, pageBlocks: res.pageBlocks.length, scriptletHosts: scriptletHosts.length };
  }
  writeFileSync(join(out, "data", "summary.json"), JSON.stringify({ builtAt: new Date().toISOString(), groups: summary }, null, 1));
  return summary;
}
