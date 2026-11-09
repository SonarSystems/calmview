# Calmview: privacy policy

_Last updated: 8 November 2026_

**What it collects: nothing.** Calmview has no servers, accounts, analytics or tracking. The developer never receives information about you or the pages you visit.

**How it works.** Blocking is done by Chrome's built-in blocking engine using filter lists packaged inside the extension. To hide leftover ad boxes, Calmview's content script reads the class names and ids of elements on the page and passes them to Calmview's own background service, inside your browser, to pick the matching hiding rules. It never reads form values or what you type, and never sends page content anywhere.

**The one optional exception.** If you turn on "Skip sponsor segments" for YouTube, Calmview asks SponsorBlock (sponsor.ajay.app) for segment times. It sends only the first 4 characters of a SHA-256 hash of the video's id, which thousands of videos share, so SponsorBlock can't tell which video you're watching. It's off by default.

**If you report a problem.** "Something not working? → Email it" opens your own email app with the site's name, your Calmview version and which lists are on, addressed to support@sonarsystems.co.uk. Nothing is sent unless you send that email.

**Stored on your device.** In Chrome's local extension storage: your settings, paused sites, sites on lighter blocking, your own filters and elements you hid, and running totals of what was blocked (daily totals kept for 30 days). Nothing is synced. Uninstalling deletes it all.

**Third parties.** None, apart from the optional SponsorBlock lookup above. No data is shared, sold or transferred.

**Contact:** support@sonarsystems.co.uk
