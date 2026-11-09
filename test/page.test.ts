// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { constValue, prune, run, SCRIPTLETS, toRegex } from "../src/main/scriptlets";
import { stripAds } from "../src/main/youtube";
import { parseProcedural, select } from "../src/content/procedural";
import { selectorFor } from "../src/content/picker";
import { addCounts, countMatches, emptyStats } from "../src/lib/stats";
import { normalise, pausedEntry, siteHides } from "../src/lib/settings";

const W = window as unknown as Record<string, unknown>;

describe("scriptlets", () => {
  it("set-constant replaces a value even before the page creates its parent", () => {
    SCRIPTLETS["set-constant"]("hushTest1.config.showAds", "false");
    W.hushTest1 = { config: { showAds: true, other: 1 } };
    expect((W.hushTest1 as { config: { showAds: boolean; other: number } }).config).toEqual({ showAds: false, other: 1 });
  });
  it("several scriptlets can wait on the same object", () => {
    SCRIPTLETS["abort-on-property-read"]("hushTest7.listener");
    SCRIPTLETS["set-constant"]("hushTest7.config", "undefined");
    W.hushTest7 = { config: { wall: true }, listener: 1 };
    const t = W.hushTest7 as Record<string, unknown>;
    expect(t.config).toBeUndefined();
    expect(() => t.listener).toThrow(ReferenceError);
  });
  it("abort-on-property-read throws when the page reads it", () => {
    SCRIPTLETS["abort-on-property-read"]("hushTest2");
    expect(() => W.hushTest2).toThrow(ReferenceError);
  });
  it("json-prune removes ad keys from JSON.parse results, only when required keys are present", () => {
    SCRIPTLETS["json-prune"]("playerResponse.adPlacements", "playerResponse");
    expect(JSON.parse('{"playerResponse":{"adPlacements":[1],"video":2}}')).toEqual({ playerResponse: { video: 2 } });
    expect(JSON.parse('{"adPlacements":[1]}')).toEqual({ adPlacements: [1] });
  });
  it("prune supports wildcards and removing whole array items", () => {
    const o = { entries: [{ command: { ad: { isAd: true } } }, { command: { video: 1 } }], a: { x: { ad: 1 }, y: { ad: 2 } } };
    prune(o, "entries.[-].command.ad.isAd a.*.ad");
    expect(o).toEqual({ entries: [{ command: { video: 1 } }], a: { x: {}, y: {} } });
  });
  it("no-setTimeout-if swallows matching timers only", async () => {
    SCRIPTLETS["no-setTimeout-if"]("adblockCheck");
    const hits: string[] = [];
    setTimeout(function adblockCheck() {
      hits.push("detector");
    }, 1);
    setTimeout(() => hits.push("normal"), 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(hits).toEqual(["normal"]);
  });
  it("set-local-storage-item writes consent-style values", () => {
    SCRIPTLETS["set-local-storage-item"]("consent", "accepted");
    expect(localStorage.getItem("consent")).toBe("accepted");
  });
  it("run() applies a site's calls, its parents' calls and entity calls, and honours exceptions", () => {
    const ran = run(
      {
        run: { "news.example": [["set-constant", "hushT3", "1"]], "example.co.uk": [["set-constant", "hushT4", "true"]], "shop.*": [["set-constant", "hushT5", "true"]] },
        except: { "news.example": ['["noeval"]'], "example.co.uk": ['["set-constant","hushT4","true"]'] },
      },
      "www.news.example",
    );
    expect(ran).toEqual(["set-constant"]);
    expect(W.hushT3).toBe(1);
    expect(W.hushT4).toBeUndefined(); // that exact call is excepted
    expect(run({ run: { "shop.co.uk": [] , "shop.*": [["set-constant", "hushT5", "true"]] }, except: {} }, "www.shop.co.uk")).toEqual(["set-constant"]);
    expect(run({ run: { "a.example": [["set-constant", "hushT6", "1"]] }, except: { "a.example": ["*"] } }, "a.example")).toEqual([]);
  });
  it("reads uBO patterns and value tokens", () => {
    expect(toRegex("/ad[sx]/i").test("ADS")).toBe(true);
    expect(toRegex("a.b").test("axb")).toBe(false);
    expect(constValue("noopFunc").value).toBeTypeOf("function");
    expect(constValue("emptyArr").value).toEqual([]);
    expect(constValue("42").value).toBe(42);
  });
});

describe("YouTube data", () => {
  it("strips ad slots from a player response and feed ads from browse data", () => {
    const player = { playerAds: [1], adPlacements: [2], adSlots: [3], videoDetails: { videoId: "x" } };
    expect(stripAds(player)).toBe(true);
    expect(player).toEqual({ videoDetails: { videoId: "x" } });
    const feed = { contents: [{ richItemRenderer: { content: { adSlotRenderer: {} } } }, { richItemRenderer: { content: { videoRenderer: { id: 1 } } } }] };
    stripAds(feed);
    expect(feed.contents).toHaveLength(1);
  });
});

describe("procedural filters", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="feed">
      <article class="post"><span class="label">Sponsored</span><p>Buy now</p></article>
      <article class="post"><span class="label">Friend</span><p>Hello</p></article>
      <div class="wrap"><div><span class="ad-mark">Ad</span></div></div>
    </div>`;
  });
  it(":has-text finds elements by their text", () => {
    const t = parseProcedural("article.post:has-text(/sponsor/i)")!;
    expect(select(t).map((e) => e.textContent?.includes("Buy"))).toEqual([true]);
  });
  it(":upward climbs to an ancestor; :remove() is an action", () => {
    const t = parseProcedural(".ad-mark:upward(2):remove()")!;
    expect(t.action.kind).toBe("remove");
    expect(select(t)[0].className).toBe("wrap");
  });
  it(":has() with a procedural inside, and plain CSS after an operator", () => {
    const t = parseProcedural(".feed > article:has(.label:has-text(Sponsored)) > p")!;
    expect(select(t).map((e) => e.textContent)).toEqual(["Buy now"]);
  });
  it("leaves plain CSS alone", () => {
    expect(parseProcedural(".feed > article")).toBeNull();
  });
});

describe("picker selectors", () => {
  it("are short and unique, skip generated classes and random ids", () => {
    document.body.innerHTML = `<div id="sidebar"><div class="box css-1x2y3z9"><a class="promo">1</a></div><div class="box"><a class="promo">2</a></div></div><div id="a8f9e7c6d5">x</div>`;
    const target = document.querySelectorAll(".promo")[1];
    const sel = selectorFor(target);
    expect(sel).not.toContain("css-1x2y3z9");
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(target);
    expect(selectorFor(document.getElementById("a8f9e7c6d5")!)).not.toContain("#a8f9e7c6d5");
  });
});

describe("stats and settings", () => {
  it("counts matched rules once, by kind", () => {
    const m = [
      { rule: { rulesetId: "ads" }, timeStamp: 10 },
      { rule: { rulesetId: "privacy" }, timeStamp: 11 },
      { rule: { rulesetId: "ads" }, timeStamp: 5 },
    ];
    expect(countMatches(m, 6)).toEqual({ counts: { ads: 1, trackers: 1 }, newest: 11 });
    const s = addCounts(emptyStats(0), { ads: 2, skipped: 1 }, Date.UTC(2026, 10, 7, 12));
    expect(s.total).toBe(3);
    expect(Object.values(s.days)).toEqual([3]);
  });
  it("pauses a site with its subdomains, and finds things hidden there", () => {
    const s = normalise({ paused: ["bbc.co.uk"], userFilters: "bbc.co.uk##.promo\nother.com##.x\n||ads^" });
    expect(pausedEntry(s, "www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(pausedEntry(s, "notbbc.co.uk")).toBeUndefined();
    expect(siteHides(s, "www.bbc.co.uk")).toEqual(["bbc.co.uk##.promo"]);
  });
  it("fills in defaults for new settings", () => {
    const s = normalise({ groups: { ads: false } as never });
    expect(s.groups).toMatchObject({ ads: false, privacy: true, annoyances: false });
    expect(s.youtube).toEqual({ skipSponsors: false, hideShorts: false });
  });
});

describe("JSON edit queries (YouTube's current rules)", async () => {
  const { applyQuery, parseQuery } = await import("../src/main/jsonq");
  const req = () => ({ attestationRequest: {}, context: { client: { clientName: "WEB", userAgent: "Mozilla/5.0 (Mac; channel)" } }, playbackContext: { contentPlaybackContext: { referer: "https://www.youtube.com/watch" } } });
  it("merges into a nested object only when every filter matches", () => {
    const q = parseQuery('[?.attestationRequest][?.context.client.userAgent*="channel"].context.client[?.clientName=="WEB"]+={"clientScreen":"CHANNEL"}');
    const a = req();
    expect(applyQuery(a, q)).toBe(true);
    expect(a.context.client).toMatchObject({ clientScreen: "CHANNEL" });
    const b = { ...req(), context: { client: { clientName: "WEB", userAgent: "plain" } } };
    expect(applyQuery(b, q)).toBe(false);
  });
  it("sets values, ${now} and repl()", () => {
    const a = req();
    applyQuery(a, parseQuery('[?.attestationRequest][?.context.client.userAgent=/adunit|channel/].playbackContext.contentPlaybackContext.referer=repl({"regex":"(?:#reloadxhr)?$","replacement":"#reloadxhr"})'));
    expect(a.playbackContext.contentPlaybackContext.referer).toBe("https://www.youtube.com/watch#reloadxhr");
    applyQuery(a, parseQuery('[?.attestationRequest].playbackContext.contentPlaybackContext.lactMilliseconds="${now}"'));
    expect(Number((a.playbackContext.contentPlaybackContext as Record<string, unknown>).lactMilliseconds)).toBeGreaterThan(1e12);
  });
  it("deletes deep matches (m.youtube feed ads)", () => {
    const page = { x: { itemSectionRenderer: { contents: [{ adSlotRenderer: {} }, { videoRenderer: { id: 1 } }] } } };
    expect(applyQuery(page, parseQuery("..itemSectionRenderer.contents.*[?.adSlotRenderer]"))).toBe(true);
    expect(page.x.itemSectionRenderer.contents).toEqual([{ videoRenderer: { id: 1 } }]);
  });
  it("trusted-edit-inbound-object edits a copy of the argument", () => {
    SCRIPTLETS["trusted-edit-inbound-object"]("JSON.stringify", "0", '[?.attestationRequest].context.client+={"clientScreen":"CHANNEL"}');
    const a = req();
    expect(JSON.parse(JSON.stringify(a)).context.client.clientScreen).toBe("CHANNEL");
    expect((a.context.client as Record<string, unknown>).clientScreen).toBeUndefined();
    expect(JSON.stringify({ other: 1 })).toBe('{"other":1}');
  });
});
