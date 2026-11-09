// Writes a standalone copy of Calmview (its source is GPLv3, so it's published) to a folder that
// builds on its own, outside the monorepo:
//   node scripts/export-public.mjs <out-dir> [--repo https://github.com/<owner>/calmview]
// Layout: the extension at the root, the shared cross-promo package under packages/, a pnpm
// workspace tying them together. Build outputs, downloaded lists and test results are left out.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const mono = join(here, "../..");
const out = process.argv[2];
const repo = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : "";
if (!out) throw new Error("usage: export-public.mjs <out-dir> [--repo <url>]");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const SKIP = /(^|\/)(node_modules|dist|dist-store|release|lists|test-results|playwright-report|\.DS_Store)(\/|$)/;
const copy = (from, to) => cpSync(from, to, { recursive: true, filter: (src) => !SKIP.test(relative(from, src)) });

copy(here, out);
// The monorepo's tsconfig base, next to the extension instead of two levels up.
cpSync(join(mono, "tsconfig.base.json"), join(out, "tsconfig.base.json"));
const ts = JSON.parse(readFileSync(join(out, "tsconfig.json"), "utf8"));
ts.extends = "./tsconfig.base.json";
writeFileSync(join(out, "tsconfig.json"), `${JSON.stringify(ts, null, 2)}\n`);

// The shared "More from the maker" package: source only (its catalogue is generated in the monorepo).
const promo = join(out, "packages/cross-promo");
mkdirSync(promo, { recursive: true });
for (const f of ["src", "README.md", "tsconfig.json", "promo.config.json"]) cpSync(join(mono, "packages/cross-promo", f), join(promo, f), { recursive: true });
const ppkg = JSON.parse(readFileSync(join(mono, "packages/cross-promo/package.json"), "utf8"));
ppkg.scripts = { typecheck: "tsc -p ." };
delete ppkg.devDependencies["@playwright/test"];
writeFileSync(join(promo, "package.json"), `${JSON.stringify(ppkg, null, 2)}\n`);

// Workspace + the root's shared dev tools.
const pkg = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(join(mono, "package.json"), "utf8"));
pkg.name = "calmview";
pkg.description = "Calmview: a fast, simple, private ad blocker for Chrome, YouTube included.";
pkg.license = "GPL-3.0-only";
if (repo) pkg.repository = { type: "git", url: repo };
pkg.packageManager = rootPkg.packageManager;
pkg.devDependencies = { ...rootPkg.devDependencies, ...pkg.devDependencies };
// Pin to the versions this monorepo is tested with (a fresh install would otherwise pick newer ones,
// e.g. a Playwright whose browser isn't downloaded yet).
for (const name of Object.keys(pkg.devDependencies)) {
  for (const dir of [join(here, "node_modules", name), join(mono, "node_modules", name)]) {
    if (existsSync(join(dir, "package.json"))) {
      pkg.devDependencies[name] = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
      break;
    }
  }
}
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(join(out, "pnpm-workspace.yaml"), 'packages:\n  - "."\n  - "packages/*"\n');
writeFileSync(join(out, ".gitignore"), ["node_modules/", "dist/", "dist-store/", "release/", "lists/", "test-results/", "playwright-report/", ".DS_Store", ""].join("\n"));

// The privacy policy at a short, stable address for the store listing.
cpSync(join(here, "store/PRIVACY.md"), join(out, "PRIVACY.md"));

// A README for people, not the monorepo's working notes.
const speed = JSON.parse(readFileSync(join(here, "store/speed.json"), "utf8")).sites;
const rows = speed.map((r) => `| ${r.site} | ${r.withoutS} s | ${r.withS} s | ${Math.round((1 - r.withS / r.withoutS) * 100)}% |`).join("\n");
writeFileSync(
  join(out, "README.md"),
  `# Calmview

A fast, simple, private ad blocker for Chrome. Ads, trackers, pop-ups and cookie banners are blocked
on every site, YouTube included, with one switch per site and nothing leaving your browser.

![Calmview](store/screenshot-1.png)

## Why another ad blocker?

- **Faster pages.** Ads and trackers never download, so busy sites load faster and use less data.
  Clean sites stay just as quick, because blocking runs in Chrome's own engine.

  | Site | Without | With Calmview | Faster |
  | --- | --- | --- | --- |
${rows.split("\n").map((l) => `  ${l}`).join("\n")}

  Median of 5 loads, cache off, measured 8 Nov 2026 (\`test/e2e/live.spec.ts\`, "speed").
- **Simple.** One switch per site, one number, one "hide this" button. If a site misbehaves,
  "Something not working?" offers lighter blocking: ads stay out and the page is left alone.
- **YouTube.** Ad slots are removed before the player sees them; any ad that slips through is muted,
  sped up and skipped. Optional sponsor skipping (SponsorBlock) and Hide Shorts.
- **Safer.** Known malware and scam sites are stopped before they load, with a clear explanation.
- **Private.** No account, no server, no analytics. See [PRIVACY.md](PRIVACY.md).

## Build it

\`\`\`bash
pnpm install
pnpm build          # downloads the filter lists on first build, compiles them, builds dist/
# chrome://extensions → Developer mode → Load unpacked → dist/
pnpm test           # unit tests
pnpm test:e2e       # headless end-to-end tests, every screen in light and dark
pnpm release        # fresh lists, version bump, all tests on the store build, zip in release/
\`\`\`

## How it works

Filter lists are compiled at build time into Chrome \`declarativeNetRequest\` rulesets (plain-host
filters merged into a few rules), a cosmetic index injected as a user stylesheet, and per-site
scriptlets that run before the page's own scripts. Details in \`src/lib/filters/\` and \`src/main/\`.

## Licence and credits

GPLv3 (see [LICENSE](LICENSE)). Built on volunteer-run filter lists; see [CREDITS.md](CREDITS.md).

Support: support@sonarsystems.co.uk
`,
);
console.log(`Exported to ${out}${existsSync(join(out, "LICENSE")) ? " (with LICENSE)" : ""}`);
