// Renders assets/icon.svg to the PNG sizes Chrome and the Web Store need (uses Playwright's Chromium).
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "assets/icon.svg"), "utf8");
const out = join(root, "static/icons");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(out, `icon${size}.png`), omitBackground: true });
}
// Big preview for checking the design.
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(`<html><body style="margin:0">${svg.replace("<svg ", '<svg width="512" height="512" ')}</body></html>`);
await page.screenshot({ path: join(root, "assets/icon-preview.png"), omitBackground: true });
await browser.close();
console.log("icons written to static/icons");
