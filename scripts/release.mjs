// One command to cut a release (lists change weekly, and MV3 rules only update with a new version):
//   pnpm release            fresh lists → bump patch version → typecheck, unit + e2e (store build) → zip
//   pnpm release --minor    same, bumping the minor version
// Stops at the first failure and leaves the version alone. Upload release/<name>-<version>.zip by hand.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, env = {}) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
};
const manifestFile = join(root, "static/manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const [maj, min, pat] = manifest.version.split(".").map(Number);
const next = process.argv.includes("--minor") ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

run("node scripts/update-lists.mjs");
run("pnpm typecheck");
run("pnpm test");
manifest.version = next;
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
try {
  run("node scripts/build.mjs --store");
  run("pnpm exec playwright test extension", { DIST: "dist-store" });
} catch (e) {
  manifest.version = `${maj}.${min}.${pat}`;
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.error(`\nRelease stopped; version left at ${manifest.version}.`);
  process.exit(1);
}
console.log(`\nReady: release/${String(manifest.short_name).toLowerCase()}-${next}.zip. Upload it in the Chrome Web Store dashboard.`);
