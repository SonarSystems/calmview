// Fixture sites for the e2e tests, served over HTTPS on their real host names: Chrome maps every name
// to this server with --host-resolver-rules="MAP * 127.0.0.1:<port>", so URLs carry no port and look
// exactly like the real thing (path filters such as ||host/js/x.js don't match "host:1234/js/x.js").
// A throwaway certificate is made per run: several of these hosts are HSTS-preloaded (youtube.com).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface FixtureServer {
  port: number;
  url: (host: string, path?: string) => string;
  /** Chrome flag that sends every host name to this server. */
  resolverRule: string;
  hits: string[];
  close(): Promise<void>;
}

export const VIDEO_ID = "dQw4w9WgXcQ";
const clip = readFileSync(fileURLToPath(new URL("./fixtures/clip.webm", import.meta.url)));

/** Sites, by host. Each page records what loaded in window.__hush so tests can read it. */
function page(title: string, body: string, head = ""): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.5 Georgia,serif;margin:0;background:#fff;color:#111}main{max-width:720px;margin:0 auto;padding:24px}header{background:#0b3d91;color:#fff;padding:14px 24px;font:700 22px system-ui}.card{border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0;background:#fafafa}</style>
<script>window.__hush={}</script>${head}</head><body>${body}</body></html>`;
}

function newsPage(port: number): string {
  void port;
  const u = (h: string, p: string) => `https://${h}${p}`;
  return page(
    "The Daily Lantern – Local news",
    `<header>The Daily Lantern</header><main>
<h1 id="headline">Council approves new riverside park</h1>
<p id="story">The park will open next spring with a playground, a café and two miles of new footpaths along the river.</p>
<div class="ad-slot" id="slot1"><b>ADVERTISEMENT</b> Win a cruise!</div>
<div class="sponsored-post">Sponsored: Ten tricks banks hate</div>
<div class="card" id="related"><h2>Related</h2><p>Bus routes change from Monday.</p></div>
<p id="more">Work begins next month and should take about nine months.</p>
<img id="pixel" src="${u("pagead2.googlesyndication.com", "/pixel.gif")}" width="1" height="1" alt="">
</main>
<script src="${u("adnxs.com", "/ad.js")}"></script>
<script src="${u("static.hotjar.com", "/c/hotjar.js")}"></script>
<script src="${u("cdn.lantern.example", "/app.js")}"></script>`,
  );
}

function youtubePage(port: number, path: string): string {
  const shortsShelf = `<ytd-rich-shelf-renderer is-shorts id="shorts-shelf">Shorts shelf</ytd-rich-shelf-renderer>`;
  if (!path.startsWith("/watch")) {
    return page("YouTube", `<main><ytd-rich-item-renderer id="feed-ad"><div id="content"><ytd-ad-slot-renderer>Promoted</ytd-ad-slot-renderer></div></ytd-rich-item-renderer><ytd-rich-item-renderer id="feed-video"><div id="content">A real video</div></ytd-rich-item-renderer>${shortsShelf}</main>`);
  }
  return page(
    "Test video - YouTube",
    `<main>
<div id="movie_player" class="html5-video-player"><video id="v" src="/clip.webm" muted playsinline width="320" height="180"></video>
<button class="ytp-skip-ad-button" id="skip" style="display:none">Skip</button></div>
<div id="player-ads">Companion ad</div>
<ytd-merch-shelf-renderer id="merch">Merch</ytd-merch-shelf-renderer>
${shortsShelf}
</main>
<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${VIDEO_ID}"},"adPlacements":[{"adPlacementRenderer":{}}],"playerAds":[{"x":1}],"adSlots":[{"y":2}]};
window.__hush.adsInPlayer = !!(ytInitialPlayerResponse.adPlacements || ytInitialPlayerResponse.playerAds || ytInitialPlayerResponse.adSlots);
window.__hush.video = ytInitialPlayerResponse.videoDetails.videoId;
document.getElementById("skip").addEventListener("click", () => { window.__hush.skipClicked = (window.__hush.skipClicked || 0) + 1; });
</script>`,
  );
}

// ---------- demo pages (pnpm demo-video): the same structures, dressed up to look like real sites ----------

const BANNER = (text: string, colour: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="728" height="90" viewBox="0 0 728 90"><rect width="728" height="90" rx="6" fill="${colour}"/><text x="24" y="58" font-family="Arial Black,Arial" font-size="34" fill="#fff">${text}</text><rect x="560" y="22" width="148" height="46" rx="23" fill="#fff"/><text x="584" y="53" font-family="Arial" font-weight="bold" font-size="20" fill="${colour}">CLICK NOW</text></svg>`;

function demoNewsPage(): string {
  const ad = (t: string, c: string, w = 728, h = 90) => `<div class="ad-slot" style="margin:18px auto;width:${w}px;max-width:100%"><img src="https://adnxs.com/banner.svg?t=${encodeURIComponent(t)}&c=${encodeURIComponent(c)}" width="${w}" height="${h}" alt="" style="display:block;width:100%;height:auto"></div>`;
  return page(
    "The Daily Lantern – Council approves riverside park",
    `<header style="display:flex;align-items:center;gap:24px">The Daily Lantern<span style="font:500 14px system-ui;opacity:.85">News · Sport · Weather · Culture</span></header>
${ad("WIN A CRUISE TODAY!", "#e11d48")}
<main style="max-width:760px">
<p style="font:600 13px system-ui;color:#0b3d91;text-transform:uppercase;letter-spacing:.06em;margin:0">Local news</p>
<h1 id="headline" style="font-size:38px;line-height:1.15;margin:6px 0 10px">Council approves new riverside park after five-year campaign</h1>
<p style="color:#555;font:14px system-ui">By Priya Shah · 8 November 2026</p>
<div class="sponsored-post" style="background:#fff7d6;border:1px solid #f1c40f;padding:14px;border-radius:8px;font:15px system-ui"><b>Sponsored</b> · Ten tricks banks don't want you to know. Number 7 will shock you!</div>
<p id="story">The park will open next spring with a playground, a café and two miles of new footpaths along the river. Residents first asked for the space in 2021, when the old warehouses were demolished.</p>
${ad("CHEAP FLIGHTS £9", "#7c3aed", 728, 90)}
<p>Councillors voted 31 to 4 in favour on Thursday evening. Work begins next month and should take about nine months, the council said.</p>
<div class="card" id="related"><h2 style="margin-top:0">Related</h2><p>Bus routes change from Monday · New cycle lane opens on Station Road</p></div>
<p>The project is funded by a mix of council money and a £2.4m government grant for green spaces.</p>
</main>
<script src="https://adnxs.com/ad.js"></script>
<script src="https://static.hotjar.com/c/hotjar.js"></script>`,
  );
}

function demoWatchPage(): string {
  return page(
    "Sourdough at home - YouTube",
    `<style>body{background:#0f0f0f;color:#f1f1f1;font-family:system-ui}.top{display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid #272727;font:700 20px system-ui}.top .s{flex:1;max-width:520px;margin:0 auto;background:#121212;border:1px solid #303030;border-radius:20px;padding:8px 16px;font:400 14px system-ui;color:#aaa}
.wrap{display:flex;gap:24px;padding:20px 24px}.main{flex:1}#movie_player{position:relative;background:#000;border-radius:12px;overflow:hidden}#movie_player video{width:100%;display:block;aspect-ratio:16/9}
#movie_player.ad-showing::after{content:"Ad · 0:30";position:absolute;left:12px;bottom:12px;background:#fbbf24;color:#000;font:700 13px system-ui;padding:3px 8px;border-radius:4px}
.ytp-skip-ad-button{position:absolute;right:0;bottom:40px;background:rgba(0,0,0,.7);color:#fff;border:0;padding:10px 18px;font:600 15px system-ui}
h1{font-size:20px;margin:12px 0 4px}.side{width:360px}.rec{display:flex;gap:8px;margin-bottom:12px;font-size:14px}.rec i{width:160px;height:90px;border-radius:8px;flex:none;background:linear-gradient(135deg,#334155,#64748b)}
#player-ads{background:#fde047;color:#000;border-radius:8px;padding:16px;margin-bottom:12px;font-weight:700}ytd-merch-shelf-renderer{display:block;background:#1f2937;border-radius:8px;padding:16px;margin-top:12px}
ytd-rich-shelf-renderer{display:block;background:#1e1b4b;border-radius:8px;padding:16px;margin-top:12px}</style>
<div class="top">▶ VideoTube<span class="s">Search</span></div>
<div class="wrap"><div class="main">
<div id="movie_player" class="html5-video-player"><video id="v" src="/clip.webm" muted playsinline></video><button class="ytp-skip-ad-button" id="skip" style="display:none">Skip ›</button></div>
<h1>Sourdough at home: the only guide you need</h1><div style="color:#aaa;font-size:14px">The Bread Shed · 214k views</div>
<ytd-merch-shelf-renderer id="merch">🛍️ Merch shelf: The Bread Shed hoodies from £39</ytd-merch-shelf-renderer>
<ytd-rich-shelf-renderer is-shorts id="shorts-shelf">Shorts · 30-second bread hacks · Crumb shots · Oven spring</ytd-rich-shelf-renderer>
</div><div class="side"><div id="player-ads">SPONSORED · Get 50% off your first meal kit</div>
${["Baguettes in 4 steps", "Why your loaf is flat", "Starter from scratch", "Proving baskets compared"].map((t) => `<div class="rec"><i></i><div>${t}<div style="color:#aaa;font-size:12px;margin-top:4px">The Bread Shed</div></div></div>`).join("")}
</div></div>
<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${VIDEO_ID}"},"adPlacements":[{"adPlacementRenderer":{}}],"playerAds":[{"x":1}]};
window.__hush.adsInPlayer = !!(ytInitialPlayerResponse.adPlacements || ytInitialPlayerResponse.playerAds);
document.getElementById("skip").addEventListener("click", () => { window.__hush.skipClicked = (window.__hush.skipClicked || 0) + 1; });</script>`,
  );
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const dir = mkdtempSync(join(tmpdir(), "hush-cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2", "-subj", "/CN=hush.test"], { stdio: "ignore" });
  const hits: string[] = [];
  let port = 0;
  const server = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const url = new URL(req.url ?? "/", `https://${host}`);
    hits.push(`${host}${url.pathname}${url.search}`);
    // "connection: close": Chrome reuses idle sockets Node has closed, which stalls requests.
    const send = (status: number, type: string, body: string | Buffer) =>
      res.writeHead(status, { "content-type": type, connection: "close", "access-control-allow-origin": "*", "cache-control": "no-store" }).end(body);
    const html = (b: string) => send(200, "text/html; charset=utf-8", b);
    const js = (b: string) => send(200, "text/javascript", b);

    if (host === "news.lantern.example") {
      if (url.pathname === "/") return html(newsPage(port));
      if (url.pathname === "/demo") return html(demoNewsPage());
      if (url.pathname === "/clean") return html(page("The Daily Lantern – About", `<header>The Daily Lantern</header><main><h1>About us</h1><p id="story">We are a local paper.</p><div class="card">Contact the newsroom any time.</div></main>`));
    }
    if (host === "adnxs.com") {
      if (url.pathname === "/banner.svg") return send(200, "image/svg+xml", BANNER(url.searchParams.get("t") ?? "MEGA SALE", url.searchParams.get("c") ?? "#e11d48"));
      return js("window.__hush.adScript = true;");
    }
    if (host === "pagead2.googlesyndication.com") return send(200, "image/gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
    if (host === "static.hotjar.com") return js("window.__hush.tracker = true;");
    if (host === "cdn.lantern.example") return js("window.__hush.app = true;");
    // Video pre-rolls: a player loading Google's IMA SDK on a site the lists cover with a stand-in.
    if (host === "maharashtratimes.com") {
      return html(page("Video", `<main><h1>Trailer</h1><div id="player">Player</div></main><script src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"></script><script>window.__hush.ima = window.google && google.ima ? (google.ima.__hush ? "stand-in" : "real") : "missing";</script>`));
    }
    if (host === "imasdk.googleapis.com") return js("window.google = {ima: {real: true}};");
    // A list scriptlet: "sueddeutsche.de##+js(set, _sp_.config, undefined)".
    if (host === "www.sueddeutsche.de") {
      return html(page("SZ", `<main><h1>Nachrichten</h1></main><script>window._sp_ = {config: {consent: "wall"}}; window.__hush.spConfig = window._sp_.config;</script>`));
    }
    if (host === "www.youtube.com") {
      if (url.searchParams.get("demo")) return html(demoWatchPage());
      if (url.pathname === "/clip.webm") {
        // Range support: without it Chrome can't seek the video.
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
        if (!m) return res.writeHead(200, { "content-type": "video/webm", "content-length": clip.length, "accept-ranges": "bytes", connection: "close" }).end(clip);
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), clip.length - 1) : clip.length - 1;
        return res
          .writeHead(206, { "content-type": "video/webm", "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${clip.length}`, "accept-ranges": "bytes", connection: "close" })
          .end(clip.subarray(start, end + 1));
      }
      return html(youtubePage(port, url.pathname + url.search));
    }
    if (host === "sponsor.hush.test" && url.pathname.startsWith("/api/skipSegments/")) {
      return send(200, "application/json", JSON.stringify([{ videoID: VIDEO_ID, segments: [{ segment: [4, 12], category: "sponsor", actionType: "skip" }] }, { videoID: "other", segments: [] }]));
    }
    // Hosts on the malware and ad pop-up lists: tests must never reach these pages.
    if (host === "abcdserver.com" || host === "a-ads.com") return html(page("Should be blocked", `<h1 id="reached">Reached ${host}</h1>`));
    send(404, "text/plain", "not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  return {
    port,
    hits,
    resolverRule: `--host-resolver-rules=MAP * 127.0.0.1:${port}`,
    url: (host, path = "/") => `https://${host}${path}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
