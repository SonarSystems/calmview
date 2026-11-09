// Bundles the extension.
//   node scripts/build.mjs           -> dist/  (load unpacked once; dev builds then reload themselves)
//   node scripts/build.mjs --store   -> dist-store/ + release/<short_name>-<version>.zip for the Chrome Web Store
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = process.argv.includes("--store");
const watch = process.argv.includes("--watch");
const dist = join(root, store ? "dist-store" : "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
// static/ includes icons/, rendered from assets/icon.svg by scripts/render-icons.mjs.
cpSync(join(root, "static"), dist, { recursive: true });
// The GPL and the lists' licences travel with every copy.
for (const f of ["LICENSE", "CREDITS.md"]) if (existsSync(join(root, f))) cpSync(join(root, f), join(dist, f));
// Chrome refuses to load an extension whose manifest icons are missing, and says nothing in headless
// tests (the service worker just never starts). Fail loudly instead.
for (const size of [16, 32, 48, 128]) {
  if (!existsSync(join(root, "static/icons", `icon${size}.png`))) throw new Error(`static/icons/icon${size}.png is missing: run \`pnpm icons\` (renders assets/icon.svg).`);
}

// Dev builds reload themselves: the installed extension compares this id with the one baked into its
// code every 30 s and calls chrome.runtime.reload() when they differ. That needs "alarms", added to the
// dev manifest only; store builds keep the minimal permissions and update through the Web Store.
const buildId = store ? "store" : Date.now().toString(36);
if (!store) {
  writeFileSync(join(dist, "build-id.txt"), buildId);
  const manifestPath = join(dist, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), "alarms"])];
  manifest.name = `${manifest.name} (dev)`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// Filter lists → rulesets, cosmetic data and per-site scriptlet tables. Lists are git-ignored and
// fetched on first build; `pnpm update-lists` refreshes them.
execFileSync(process.execPath, [join(root, "scripts/update-lists.mjs"), "--missing"], { stdio: "inherit" });
const tmp = join(root, "node_modules/.cache/hush");
mkdirSync(tmp, { recursive: true });
await build({ entryPoints: [join(root, "src/build/compile-lists.ts")], bundle: true, platform: "node", format: "esm", outfile: join(tmp, "compile-lists.mjs"), logLevel: "warning" });
const { compileLists } = await import(`${pathToFileURL(join(tmp, "compile-lists.mjs")).href}?t=${Date.now()}`);
const summary = compileLists(join(root, "lists"), dist);
const rules = Object.values(summary).reduce((n, g) => n + g.rules, 0);
console.log(`Filter lists: ${rules.toLocaleString("en-GB")} network rules in ${Object.keys(summary).length} rulesets`);

const common = {
  outdir: dist,
  bundle: true,
  target: "chrome120",
  sourcemap: store ? false : "linked",
  minify: true,
  logLevel: "info",
  define: { __BUILD_ID__: JSON.stringify(buildId), __STORE__: String(store) },
};
const pages = {
  ...common,
  format: "esm",
  entryPoints: { background: join(root, "src/background.ts"), popup: join(root, "src/popup/popup.ts"), options: join(root, "src/options/options.ts"), blocked: join(root, "src/blocked/blocked.ts") },
};
// Content scripts can't be modules. youtube-main.js runs in the page's own world.
const content = { ...common, format: "iife", entryPoints: { content: join(root, "src/content/main.ts"), "youtube-main": join(root, "src/main/youtube-entry.ts") } };

if (watch) {
  await (await context(pages)).watch();
  await (await context(content)).watch();
} else {
  await build(pages);
  await build(content);
}

// One page-world script per filter group: the scriptlet engine wrapped around that group's table, so
// nothing leaks into the page's globals. Registered per site by the worker.
const engine = await build({ ...common, outdir: undefined, write: false, sourcemap: false, format: "iife", entryPoints: [join(root, "src/main/scriptlets-entry.ts")] });
const engineCode = engine.outputFiles[0].text;
mkdirSync(join(dist, "scriptlets"), { recursive: true });
for (const f of readdirSync(join(dist, "data")).filter((f) => f.endsWith(".scriptlets.json"))) {
  const table = readFileSync(join(dist, "data", f), "utf8");
  writeFileSync(join(dist, "scriptlets", f.replace(".scriptlets.json", ".js")), `(()=>{const __HUSH_TABLE__=${table};\n${engineCode}})();\n`);
  rmSync(join(dist, "data", f));
}

if (store) {
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  const slug = String(manifest.short_name ?? manifest.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const release = join(root, "release");
  mkdirSync(release, { recursive: true });
  const zip = join(release, `${slug}-${manifest.version}.zip`);
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qrX", zip, "."], { cwd: dist });
  console.log(`\nStore package: ${zip}`);
}
