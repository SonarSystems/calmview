// The "pages load faster" chart for store images and the demo video, drawn from store/speed.json
// (measured, see its _about). Paired bars per site, lower is better; colours validated with the
// dataviz palette checker (orange #d9663f "without", indigo #4338ca "with", both pass on white).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Row {
  site: string;
  withoutS: number;
  withS: number;
  withoutMB: number;
  withMB: number;
}
export const SPEED = JSON.parse(readFileSync(fileURLToPath(new URL("../store/speed.json", import.meta.url)), "utf8")) as { sites: Row[] };
const pct = (a: number, b: number) => Math.round((1 - b / a) * 100);
/** Largest load-time saving, e.g. 36 (BBC News 9.4 s → 6.0 s). */
export const BEST_FASTER = Math.max(...SPEED.sites.map((r) => pct(r.withoutS, r.withS)));
export const BEST_LESS_DATA = Math.max(...SPEED.sites.map((r) => pct(r.withoutMB, r.withMB)));

/** A white chart card, `width` px wide. */
export function speedChartHtml(width = 640): string {
  const max = Math.max(...SPEED.sites.map((r) => r.withoutS));
  const bar = (v: number, colour: string, label: string) =>
    `<div style="display:flex;align-items:center;gap:10px;height:22px"><div style="height:18px;width:${(v / max) * 100}%;max-width:calc(100% - 64px);background:${colour};border-radius:0 4px 4px 0"></div><span style="font:600 15px system-ui;color:#0f172a;white-space:nowrap" aria-label="${label}">${v.toFixed(1)} s</span></div>`;
  const rows = SPEED.sites
    .map(
      (r) => `<div style="display:grid;grid-template-columns:150px 1fr 70px;align-items:center;gap:14px;padding:10px 0;border-top:1px solid #e2e8f0">
  <div style="font:600 16px system-ui;color:#0f172a">${r.site}</div>
  <div style="display:flex;flex-direction:column;gap:2px">${bar(r.withoutS, "#d9663f", "without")}${bar(r.withS, "#4338ca", "with Calmview")}</div>
  <div style="font:800 18px system-ui;color:#15803d;text-align:right">−${pct(r.withoutS, r.withS)}%</div></div>`,
    )
    .join("");
  const key = (c: string, t: string) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px"><i style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></i>${t}</span>`;
  return `<div style="width:${width}px;background:#fff;border-radius:18px;padding:22px 24px 14px;box-shadow:0 30px 70px rgba(0,0,0,.35);box-sizing:border-box;color:#0f172a;font-family:system-ui,-apple-system,sans-serif">
  <div style="font:800 22px system-ui">Page load time</div>
  <div style="font:14px system-ui;color:#5b6577;margin:2px 0 12px">Seconds, lower is better · median of 5 loads, 8 Nov 2026</div>
  <div style="font:14px system-ui;color:#334155;margin-bottom:6px">${key("#d9663f", "Without an ad blocker")}${key("#4338ca", "With Calmview")}</div>
  ${rows}</div>`;
}
