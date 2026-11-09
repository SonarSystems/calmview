// The page shown instead of a site Calmview stopped: an ad pop-up, or a site on a malware/scam list.
// Says which list, never claims more than that, and lets the person go back or carry on.
import { button, el, emptyState, icon, shell } from "../ui/theme";

const params = new URLSearchParams(location.search);
const group = params.get("g") ?? "ads";
const url = decodeURIComponent(location.hash.slice(1));
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  host = "";
}

const root = document.getElementById("app")!;
const danger = group === "malware";
const body = shell(root, {
  title: "Calmview",
  sub: danger ? "Dangerous site blocked" : "Ad page blocked",
  logo: "icons/icon48.png",
  footer: "Calmview checked this address against lists stored in your browser. Nothing was sent anywhere.",
});
document.title = danger ? "Blocked: dangerous site" : "Blocked: ad page";

const box = el("div", danger ? "item danger" : "item");
box.append(
  el("div", "t", danger ? `${host || "This site"} is on a malware and scam list` : `${host || "This page"} is an ad or pop-up page`),
  el(
    "p",
    undefined,
    danger
      ? "It's listed by URLhaus or uBlock Origin's badware list as spreading malware, fake downloads or scams. Lists can be wrong, but going back is the safe choice."
      : "Pages like this usually open by themselves from adverts. You probably didn't mean to come here.",
  ),
);
body.append(box);
if (url) {
  const p = el("p", "note");
  p.append("Address: ");
  const code = el("code", undefined, url.length > 140 ? `${url.slice(0, 140)}…` : url);
  code.style.wordBreak = "break-all";
  p.append(code);
  body.append(p);
}

const row = el("div");
row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px";
const back = button(history.length > 1 ? "Go back" : "Close this tab", () => {
  if (history.length > 1) history.back();
  else window.close();
}, "btn primary");
const go = button("Continue anyway", async () => {
  await chrome.runtime.sendMessage({ type: "proceed", url });
  location.replace(url);
}, "btn");
go.title = "Allows this site in this tab until you close Chrome";
if (!url) go.hidden = true;
row.append(back, go);
body.append(row);
if (!url) body.append(emptyState("Nothing to show", "This page opens when Calmview stops a site."));
void icon;
