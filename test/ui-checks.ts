// Visual quality checks for extension UI (popup, options, in-page panels), run in the e2e tests:
// - every piece of visible text meets WCAG contrast (catches unstyled or wrongly themed UI, e.g.
//   black text on a dark popup), including text inside shadow roots;
// - icons/SVGs stay icon-sized (catches a logo blowing up when its CSS didn't load);
// - nothing overflows sideways.
// On a web page, pass `scope` (e.g. "#my-ext-root") to judge only the extension's own UI: the host
// page's colours aren't ours to fix.
import type { Frame, Page } from "@playwright/test";

export interface UiProblem {
  kind: "contrast" | "icon-size" | "overflow";
  detail: string;
}

export async function uiProblems(page: Page | Frame, opts: { maxIcon?: number; scope?: string } = {}): Promise<UiProblem[]> {
  return page.evaluate(({ maxIcon, scope }) => {
    const problems: { kind: "contrast" | "icon-size" | "overflow"; detail: string }[] = [];
    // Any CSS colour (rgb(), color(srgb …), oklab() from color-mix …) as 0–255 RGB and alpha: plain
    // rgb() is read directly; anything else is painted on a 1×1 canvas and read back.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    const parse = (c: string): [number, number, number, number] => {
      if (/^rgba?\(/.test(c)) {
        const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
        return [m[0], m[1], m[2], m[3] ?? 1];
      }
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = "rgba(0,0,0,0)";
      g.fillStyle = c;
      g.fillRect(0, 0, 1, 1);
      const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data;
      return [r, gg, b, a / 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const parentOf = (e: Element): Element | null => e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null);
    /** The colour actually behind an element: the first opaque background up the tree. */
    const background = (e: Element): number[] => {
      for (let x: Element | null = e; x; x = parentOf(x)) {
        const [r, g, b, a] = parse(getComputedStyle(x).backgroundColor);
        if (a > 0.5) return [r, g, b];
      }
      // Nothing painted: the canvas colour depends on the colour scheme.
      return matchMedia("(prefers-color-scheme: dark)").matches && getComputedStyle(document.documentElement).colorScheme.includes("dark") ? [18, 18, 18] : [255, 255, 255];
    };
    const visit = (root: Document | ShadowRoot) => {
      for (const e of root.querySelectorAll("*")) {
        if (e.shadowRoot) visit(e.shadowRoot);
        const cs = getComputedStyle(e);
        const rect = e.getBoundingClientRect();
        if (cs.visibility === "hidden" || cs.display === "none" || rect.width === 0 || rect.height === 0 || Number(cs.opacity) < 0.1) continue;
        const tag = e.tagName.toLowerCase();
        if ((tag === "svg" || tag === "img") && !e.closest("[data-allow-large]") && !e.hasAttribute("data-allow-large") && (rect.width > maxIcon || rect.height > maxIcon))
          problems.push({ kind: "icon-size", detail: `<${tag}> is ${Math.round(rect.width)}×${Math.round(rect.height)}px (max ${maxIcon})` });
        const ownText = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
        if (!ownText) continue;
        const fg = parse(cs.color);
        const bg = background(e);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        const r = ratio(fg.slice(0, 3), bg);
        if (r < (large ? 3 : 4.5)) problems.push({ kind: "contrast", detail: `"${ownText.slice(0, 40)}" contrast ${r.toFixed(2)}:1 (${cs.color} on rgb(${bg.join(",")}))` });
      }
    };
    if (scope) for (const host of document.querySelectorAll(scope)) visit(host.shadowRoot ?? (host as unknown as Document));
    else visit(document);
    if (!scope && document.documentElement.scrollWidth > innerWidth + 1) problems.push({ kind: "overflow", detail: `page is ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px viewport` });
    return problems;
  }, { maxIcon: opts.maxIcon ?? 72, scope: opts.scope ?? null });
}

/**
 * Wait until the page has stopped changing before a screenshot or a measurement, instead of a fixed
 * sleep: fonts loaded, finite animations and transitions (a theme switch fades colours) finished, and
 * no DOM changes for a quiet spell. Quick on a quiet machine, and waits longer when the machine is
 * busy, where a fixed sleep is either wasted or too short. Infinite animations (a spinner, falling
 * snow) are left running; a clock that ticks every second still leaves quiet spells. Returns the
 * milliseconds waited; `max` caps it.
 */
export async function settle(page: Page, opts: { quiet?: number; max?: number } = {}): Promise<number> {
  return page.evaluate(async ({ quiet, max }) => {
    const t0 = performance.now();
    const left = () => Math.max(0, t0 + max - performance.now());
    const timeout = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await Promise.race([document.fonts.ready, timeout(left())]);
    const finite = () =>
      document.getAnimations().filter((a) => a.playState === "running" && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
    for (let run = finite(); run.length && left() > 0; run = finite()) {
      await Promise.race([Promise.all(run.map((a) => a.finished.catch(() => undefined))), timeout(left())]);
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        mo.disconnect();
        clearTimeout(still);
        clearTimeout(cap);
        resolve();
      };
      let still = setTimeout(done, quiet);
      const cap = setTimeout(done, left());
      const mo = new MutationObserver(() => {
        clearTimeout(still);
        still = setTimeout(done, quiet);
      });
      mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    // Two frames so the last change is painted.
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
    return Math.round(performance.now() - t0);
  }, { quiet: opts.quiet ?? 150, max: opts.max ?? 3000 });
}
