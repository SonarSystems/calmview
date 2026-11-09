# Publishing to the Chrome Web Store

1. `pnpm package` → `release/<name>-<version>.zip`.
2. Publish `store/PRIVACY.md` publicly (for example as a gist) and copy its URL.
3. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), choose **New item**, and upload the zip.
4. Copy each field from `store/LISTING.md` and upload the images.
5. Fill in the privacy practices, choose Public and the regions, then **Submit for review**.

Review usually takes 1 to 3 days, and longer (up to about 2 weeks) for a first submission or a content script on all sites. Ask for fewer permissions to get through faster. To update: bump `version` in `static/manifest.json`, run `package` again, upload on the **Package** tab, and submit.
