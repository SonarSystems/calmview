import { describe, expect, it } from "vitest";
import { badfilterKey, collectBadfilters, compileGroup, hostKeys, mergeRules, networkRule, selectorKey } from "../src/lib/filters/compile";
import { parseFilter, re2Safe, splitArgs, type NetworkFilter } from "../src/lib/filters/parse";
import { hideCss, keyedFor, planPage } from "../src/lib/cosmetic";
import { compileUserFilters } from "../src/lib/user";
import { matchPatterns } from "../src/lib/worker-helpers";

const net = (s: string) => parseFilter(s) as NetworkFilter;

describe("parseFilter: network", () => {
  it("reads a plain host block", () => {
    const f = net("||ads.example.com^");
    expect(f).toMatchObject({ kind: "network", exception: false, host: "ads.example.com", pattern: "||ads.example.com^" });
  });
  it("reads options: types, party, domains, important", () => {
    const f = net("||cdn.example/ad.js$script,third-party,domain=a.com|~b.a.com,important");
    expect(f.types).toEqual(["script"]);
    expect(f.party).toBe("third");
    expect(f.domains).toEqual(["a.com"]);
    expect(f.notDomains).toEqual(["b.a.com"]);
    expect(f.important).toBe(true);
  });
  it("skips filters with options Chrome can't do, rather than broadening them", () => {
    expect(parseFilter("||example.com^$header=x-ad:1")).toBeNull();
    expect(parseFilter("||example.com^$redirect-rule=noopjs")).toBeNull();
    expect(parseFilter("*$script,domain=google.*")).toBeNull(); // entity-only domain: can't express
  });
  it("never produces a filter that matches everything", () => {
    expect(parseFilter("*")).toBeNull();
    expect(parseFilter("$script")).toBeNull();
    expect(parseFilter("@@*$script")).toBeNull();
  });
  it("keeps regex filters only when RE2 can run them", () => {
    expect(net("/banner\\d+\\.gif/").regex).toBe("banner\\d+\\.gif");
    expect(parseFilter("/(?=ad)foo/")).toBeNull();
    expect(re2Safe("a(b)\\1")).toBe(false);
  });
  it("finds options after a $ inside a regex", () => {
    const f = net("/^https:\\/\\/x\\.com\\/ad$/$script");
    expect(f.regex).toBe("^https:\\/\\/x\\.com\\/ad$");
    expect(f.types).toEqual(["script"]);
  });
  it("reads exceptions and cosmetic switches", () => {
    expect(net("@@||site.com^$generichide")).toMatchObject({ exception: true, cosmeticOff: "generic", host: "site.com" });
    expect(parseFilter("||site.com^$generichide")).toBeNull();
  });
  it("marks whole-page blocks ($doc, $popup, $all)", () => {
    expect(net("||popads.example^$popup").page).toBe(true);
    expect(net("||bad.example^$all").page).toBe(true);
    expect(net("||bad.example^$all").types).toContain("script");
  });
});

describe("parseFilter: cosmetic and scriptlets", () => {
  it("reads generic and site-specific hiding", () => {
    expect(parseFilter("##.ad-banner")).toMatchObject({ kind: "cosmetic", domains: [], selector: ".ad-banner", procedural: false });
    expect(parseFilter("example.com,~sub.example.com##.promo")).toMatchObject({ domains: ["example.com"], notDomains: ["sub.example.com"] });
    expect(parseFilter("example.com#@#.promo")).toMatchObject({ exception: true });
  });
  it("spots procedural filters", () => {
    expect(parseFilter("example.com##div:has-text(Sponsored)")).toMatchObject({ procedural: true });
    expect(parseFilter("example.com##div:has(> .ad)")).toMatchObject({ procedural: false });
    expect(parseFilter("example.com#?#div:-abp-contains(Ad)")).toMatchObject({ selector: "div:has-text(Ad)", procedural: true });
  });
  it("reads scriptlets and maps short names", () => {
    expect(parseFilter("youtube.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)")).toMatchObject({
      kind: "scriptlet",
      name: "set-constant",
      args: ["ytInitialPlayerResponse.adPlacements", "undefined"],
      domains: ["youtube.com"],
    });
    expect(parseFilter("example.com##+js(aopr.js, adblock)")).toMatchObject({ name: "abort-on-property-read" });
    expect(parseFilter("example.com#@#+js()")).toMatchObject({ exception: true, name: "" });
  });
  it("splits scriptlet arguments with escapes and quotes", () => {
    expect(splitArgs("a, b\\, c, 'd, e', \"f\"")).toEqual(["a", "b, c", "d, e", "f"]);
  });
  it("rejects selectors that smuggle in CSS", () => {
    expect(parseFilter("example.com##.header {top:0;}")).toBeNull();
    expect(parseFilter("example.com##body } * { display: none")).toBeNull();
  });
  it("skips HTML filters and AdGuard extensions", () => {
    expect(parseFilter("example.com##^script:has-text(ad)")).toBeNull();
    expect(parseFilter("example.com#$#body { overflow: auto }")).toBeNull();
  });
});

describe("compiling to declarativeNetRequest", () => {
  it("builds block, allow, redirect and removeparam rules", () => {
    expect(networkRule(net("||ads.example^$script"))).toMatchObject({ action: { type: "block" }, condition: { requestDomains: ["ads.example"], resourceTypes: ["script"] } });
    expect(networkRule(net("@@||cdn.example/ok.js"))).toMatchObject({ action: { type: "allow" }, condition: { urlFilter: "||cdn.example/ok.js" } });
    expect(networkRule(net("||imasdk.googleapis.com/js/sdkloader/ima3.js$script,redirect=google-ima.js"))).toMatchObject({
      action: { type: "redirect", redirect: { extensionPath: "/war/google-ima.js" } },
    });
    expect(networkRule(net("$removeparam=utm_source,domain=shop.example"))).toMatchObject({
      action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: ["utm_source"] } } } },
    });
  });
  it("lets surrogate redirects beat plain blocks of the same script", () => {
    const block = networkRule(net("||imasdk.googleapis.com^"))!;
    const redirect = networkRule(net("||imasdk.googleapis.com/js/sdkloader/ima3.js$script,redirect=google-ima.js"))!;
    expect(redirect.priority).toBeGreaterThan(block.priority!);
  });
  it("turns $document exceptions into allowAllRequests", () => {
    expect(networkRule(net("@@||bank.example^$document"))).toMatchObject({ action: { type: "allowAllRequests" }, condition: { resourceTypes: ["main_frame", "sub_frame"] } });
  });
  it("merges thousands of host blocks into one rule", () => {
    const rules = mergeRules(["||a.example^", "||b.example^", "||c.example^$third-party", "||d.example^$third-party"].map((l) => networkRule(net(l))!));
    expect(rules).toHaveLength(2);
    expect(rules[0].condition.requestDomains).toEqual(["a.example", "b.example"]);
  });
  it("honours $badfilter across lists", () => {
    expect(badfilterKey("||x.com^$script,badfilter")).toBe("||x.com^$script");
    const bad = collectBadfilters(["||x.com^$script,badfilter"]);
    const g = compileGroup(["||x.com^$script\n||y.com^$script"], { badfilters: bad });
    expect(g.rules.flatMap((r) => r.condition.requestDomains)).toEqual(["y.com"]);
  });
  it("sends whole ad and malware hosts to the blocked page", () => {
    const g = compileGroup(["||popunder.example^$popup\n||malware.example^$all\n||ads.example/path$popup"]);
    expect(g.pageBlocks).toEqual(["malware.example", "popunder.example"]);
    // $all still blocks the host's other requests; $popup alone needs no network rule.
    expect(g.rules.flatMap((r) => r.condition.requestDomains ?? [])).toEqual(["malware.example"]);
  });
  it("never page-blocks a site for a filter that only cleans its links (Reddit false positive, 7 Nov 2026)", () => {
    const g = compileGroup(["||reddit.com^$doc,removeparam=ref\n||reddit.com^$doc,removeparam=/deep_link=/"]);
    expect(g.pageBlocks).toEqual([]);
    expect(g.rules).toHaveLength(1);
    expect(g.rules[0]).toMatchObject({ action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: ["ref"] } } } }, condition: { requestDomains: ["reddit.com"], resourceTypes: ["main_frame"] } });
  });
  it("indexes cosmetic filters and scriptlets", () => {
    const g = compileGroup(["##.ad-box\n##div[id^=\"ad-\"]\nnews.example##.promo\nnews.example#@#.ad-box\nnews.example##div:has-text(Advert)\nnews.example##+js(set, adsOk, true)\n@@||clean.example^$generichide"]);
    expect(g.cosmetic.keyed[".ad-box"]).toEqual([".ad-box"]);
    expect(g.cosmetic.generic).toEqual(['div[id^="ad-"]']);
    expect(g.cosmetic.hide["news.example"]).toEqual([".promo"]);
    expect(g.cosmetic.unhide["news.example"]).toEqual([".ad-box"]);
    expect(g.cosmetic.procedural["news.example"]).toEqual(["div:has-text(Advert)"]);
    expect(g.cosmetic.off.generic).toEqual(["clean.example"]);
    expect(g.scriptlets.run["news.example"]).toEqual([["set-constant", "adsOk", "true"]]);
    const ex = compileGroup(["a.example,~b.a.example##+js(set, x, 1)\nc.example#@#+js(set, x, 1)\n#@#+js(aopr, y)\nd.example#@#+js()"]).scriptlets.except;
    expect(ex).toEqual({ "b.a.example": ['["set-constant","x","1"]'], "c.example": ['["set-constant","x","1"]'], "*": ['["abort-on-property-read","y"]'], "d.example": ["*"] });
  });
  it("keys selectors only on a leading class or id", () => {
    expect(selectorKey(".ad > .x")).toBe(".ad");
    expect(selectorKey("#top-ad")).toBe("#top-ad");
    expect(selectorKey("div.ad")).toBeNull();
    expect(selectorKey(".a, .b")).toBeNull();
  });
});

describe("planning a page's cosmetics", () => {
  const g = compileGroup([
    "##.ad-box\n##div[id^=\"ad-\"]\nnews.example##.promo\nnews.example#@#div[id^=\"ad-\"]\nnews.example##.x:style(height: 0 !important)\nshop.*##.deal-ad\n@@||clean.example^$elemhide",
  ]);
  it("adds generic + site-specific, minus that site's exceptions", () => {
    const p = planPage([g.cosmetic], "www.news.example");
    expect(p.hide).toContain(".promo");
    expect(p.hide).not.toContain('div[id^="ad-"]');
    expect(p.styles).toEqual([".x { height: 0 !important }"]);
    expect(keyedFor([g.cosmetic], "news.example", [".ad-box", ".other"])).toEqual([".ad-box"]);
  });
  it("matches entity filters (shop.*) on any ending", () => {
    expect(planPage([g.cosmetic], "www.shop.co.uk").hide).toContain(".deal-ad");
    expect(hostKeys("a.b.co.uk")).toEqual(expect.arrayContaining(["a.b.co.uk", "b.co.uk", "b.*", "a.b.*"]));
  });
  it("switches cosmetics off where an exception says so", () => {
    expect(planPage([g.cosmetic], "clean.example").hide).toEqual([]);
  });
  it("writes one CSS rule per selector so one bad selector can't void the rest", () => {
    expect(hideCss([".a", "::bad"])).toBe(".a{display:none!important}\n::bad{display:none!important}");
  });
});

describe("your filters", () => {
  it("compiles network and cosmetic lines and explains the rest", () => {
    const c = compileUserFilters("||tracker.example^\nnews.example##.popup\n##.sticky-ad\nexample.com##+js(set, a, 1)\n||x^$header=foo\n! comment");
    expect(c.count).toBe(3);
    expect(c.rules[0]).toMatchObject({ action: { type: "block" }, condition: { requestDomains: ["tracker.example"] } });
    expect(c.cosmetic.hide["news.example"]).toEqual([".popup"]);
    expect(c.cosmetic.keyed[".sticky-ad"]).toEqual([".sticky-ad"]);
    expect(c.problems.map((p) => p.why)).toEqual(["Scripts (+js) only run from the built-in lists", "Calmview doesn't understand this filter"]);
  });
  it("outranks list rules", () => {
    const c = compileUserFilters("@@||ads.example^");
    expect(c.rules[0].priority).toBeGreaterThan(30);
  });
});

describe("match patterns for page-world scripts", () => {
  it("covers a host and its subdomains, expands entities, drops junk", () => {
    expect(matchPatterns(["example.com", "1.2.3.4", "bad host", "google.*"]).slice(0, 4)).toEqual(["*://*.example.com/*", "*://1.2.3.4/*", "*://*.google.com/*", "*://*.google.co.uk/*"]);
  });
});
