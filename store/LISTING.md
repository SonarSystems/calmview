# Chrome Web Store listing: copy/paste sheet

Upload: `release/<short_name>-<version>.zip` (`pnpm package`).

## Store listing tab

**Name** (manifest, ≤ 75 chars): Calmview: Ad Blocker for YouTube and the Web

**Summary** (≤ 132 chars; keep it identical to the manifest description): Blocks ads, trackers and pop-ups on every site, YouTube included, so pages load faster. One switch per site. Private by design.

**Category:** Privacy & Security · **Language:** English (UK)

**Description:**

Calmview blocks the ads, trackers and pop-ups that slow the web down, YouTube included, and keeps the controls simple.

FASTER PAGES, LESS DATA
• Ads and trackers never download, so busy sites load faster: BBC News 9.4 s → 6.0 s, The Independent 11.7 s → 7.8 s, GitHub 16.3 s → 11.3 s (median of 5 loads, measured 8 Nov 2026)
• Up to 44% less data on the sites we measured, which helps on mobile hotspots and slow Wi-Fi
• Clean sites stay just as quick: Calmview uses Chrome's built-in blocking engine, not a script on every request

WHAT IT BLOCKS
• Adverts on websites and before videos, YouTube included
• Trackers, analytics and tracking codes in links
• Sites known for malware, scams and fake downloads, stopped before they load
• Cookie banners (on by default) and, if you like, newsletter pop-ups and "get the app" banners

SIMPLE BY DESIGN
• One switch per site: pause Calmview anywhere that doesn't work properly
• Site acting up? "Something not working?" offers lighter blocking: ads and trackers stay out, the page is left alone
• Hide anything: right-click it and choose Hide this element. Undo any time
• See what was blocked on each page, and in total

FOR YOUTUBE
• Video ads removed; any that slip through are muted and skipped
• Optional: skip sponsor segments (SponsorBlock) and hide Shorts

GOOD TO KNOW
• Filter lists update with each new version of Calmview (usually weekly)
• Twitch puts ads inside the live stream, so Calmview mutes them rather than removing them

PRIVATE BY DESIGN
No account, no servers, no analytics. Nothing leaves your browser. Calmview is open source (GPLv3) and built on volunteer-run filter lists: EasyList, EasyPrivacy, uBlock Origin filters, Fanboy's lists and URLhaus.

Questions or a site that doesn't work: support@sonarsystems.co.uk

**Images** (`pnpm store-assets` → `store/`; 24-bit PNG, no alpha): icon `static/icons/icon128.png`; screenshots in this order: `screenshot-1.png` (ads gone, pages faster), `screenshot-2.png` (speed chart), `screenshot-3.png` (YouTube), `screenshot-4.png` (one-click fix), `screenshot-5.png` (malware); small tile `promo-small.png`; marquee `promo-marquee.png`.

**Promo video:** upload `store/demo.mp4` to YouTube (unlisted is fine) and paste its link.

**Support / contact:** support@sonarsystems.co.uk

## Privacy practices tab

**Single purpose:** Block adverts, trackers and harmful sites on web pages.

**Permission justifications:**
- declarativeNetRequest: blocks ad, tracker and malware requests using filter lists bundled in the extension.
- declarativeNetRequestFeedback: counts what was blocked, for the numbers shown to the user. Kept on the device.
- scripting: injects the CSS that hides leftover ad boxes, and the small scripts that stop anti-adblock walls and YouTube video ads.
- storage: settings, paused sites, the user's own filters and totals, all on the device.
- contextMenus: the "Hide this element with Calmview" right-click item.
- alarms: folds blocked-request counts into the running totals once a minute.
- Host access (all sites): ads appear on every site, so hiding and blocking must work everywhere. No page data leaves the browser.

**Remote code:** No. All filter lists and scripts are packaged in the extension. **Data usage:** tick nothing unless you really collect it, then tick all three certifications.

**Privacy policy URL:** https://github.com/SonarSystems/calmview/blob/main/PRIVACY.md

**Homepage / support URL:** https://github.com/SonarSystems/calmview · support@sonarsystems.co.uk

## Distribution tab

Public · United Kingdom (or all regions).

## Before publishing

- The bundled filter lists are GPLv3 (uBlock) and GPLv3 / CC BY-SA 3.0 (EasyList, Fanboy). Publish Calmview's source under GPLv3 and credit the lists in the description. Not legal advice.
- Rebuild with fresh lists (`pnpm update-lists && pnpm package`) right before each upload.
