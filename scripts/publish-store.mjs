// Uploads release/<name>-<version>.zip to the Chrome Web Store and (with --publish) submits it for
// review, through the Chrome Web Store API. For updates after the first manual submission.
//   node scripts/publish-store.mjs            upload the newest zip as a draft
//   node scripts/publish-store.mjs --publish  upload and submit for review
//
// One-time setup (needs your Google account, so it can't be done for you):
//   1. Google Cloud console: create a project, enable "Chrome Web Store API".
//   2. Create an OAuth client ID (type "Desktop app"); note its client id and secret.
//   3. Get a refresh token for scope https://www.googleapis.com/auth/chromewebstore
//      (e.g. via the OAuth 2.0 Playground with "use your own OAuth credentials").
//   4. Put them in experiments/2026-11-hush/.env (git-ignored at the repo root):
//        CWS_CLIENT_ID=…  CWS_CLIENT_SECRET=…  CWS_REFRESH_TOKEN=…  CWS_ITEM_ID=<the store item id>
// The listing text, images and privacy answers are edited in the dashboard, not by this script.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_ITEM_ID } = process.env;
if (!CWS_CLIENT_ID || !CWS_CLIENT_SECRET || !CWS_REFRESH_TOKEN || !CWS_ITEM_ID) {
  console.error("Missing CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN / CWS_ITEM_ID (see the setup notes at the top of this file).");
  process.exit(1);
}
const zips = readdirSync(join(root, "release")).filter((f) => f.endsWith(".zip")).sort();
const zip = zips.at(-1);
if (!zip) throw new Error("No zip in release/: run `pnpm release` first.");

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: CWS_CLIENT_ID, client_secret: CWS_CLIENT_SECRET, refresh_token: CWS_REFRESH_TOKEN, grant_type: "refresh_token" }),
});
const { access_token: token, error } = await tokenRes.json();
if (!token) throw new Error(`Couldn't get an access token: ${error ?? tokenRes.status}`);
const auth = { authorization: `Bearer ${token}`, "x-goog-api-version": "2" };

console.log(`Uploading ${zip}…`);
const up = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_ITEM_ID}`, { method: "PUT", headers: auth, body: readFileSync(join(root, "release", zip)) });
const upBody = await up.json();
console.log(JSON.stringify(upBody, null, 1));
if (upBody.uploadState !== "SUCCESS" && upBody.uploadState !== "IN_PROGRESS") process.exit(1);

if (process.argv.includes("--publish")) {
  const pub = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_ITEM_ID}/publish`, { method: "POST", headers: auth });
  console.log(JSON.stringify(await pub.json(), null, 1));
}
