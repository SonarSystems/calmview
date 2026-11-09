// Calmview's own cosmetic rules for video sites, kept apart from the filter lists so they don't depend
// on list updates. Applied by the worker on matching hosts.

export const YOUTUBE_HOSTS = ["youtube.com", "youtube-nocookie.com", "youtubekids.com"];

export function isYouTube(host: string): boolean {
  return YOUTUBE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function isTwitch(host: string): boolean {
  return host === "twitch.tv" || host.endsWith(".twitch.tv");
}

export const YOUTUBE_AD_SELECTORS = [
  "#masthead-ad",
  "ytd-ad-slot-renderer",
  "ad-slot-renderer",
  "ytd-in-feed-ad-layout-renderer",
  "ytd-banner-promo-renderer",
  "ytd-statement-banner-renderer",
  "ytd-promoted-sparkles-web-renderer",
  "ytd-promoted-video-renderer",
  "ytd-search-pyv-renderer",
  "ytd-display-ad-renderer",
  "ytd-companion-slot-renderer",
  "ytd-action-companion-ad-renderer",
  "ytd-player-legacy-desktop-watch-ads-renderer",
  "#player-ads",
  "ytd-merch-shelf-renderer",
  ".ytp-ad-overlay-container",
  ".ytp-ad-image-overlay",
  ".ytp-ad-text-overlay",
  ".ytp-featured-product",
  "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)",
  "ytd-rich-section-renderer:has(ytd-statement-banner-renderer)",
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
  "ytm-promoted-sparkles-web-renderer",
  "ytm-companion-ad-renderer",
  "ytm-rich-item-renderer:has(ad-slot-renderer)",
  // The "ad blockers are not allowed" dialog and its backdrop (the player is resumed by the content script).
  "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
  "ytd-enforcement-message-view-model",
];

export const YOUTUBE_SHORTS_SELECTORS = [
  "ytd-reel-shelf-renderer",
  "ytd-rich-shelf-renderer[is-shorts]",
  "ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
  'ytd-guide-entry-renderer:has(a[title="Shorts"])',
  'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  'ytd-video-renderer:has(a[href^="/shorts/"])',
  'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
  'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
  "grid-shelf-view-model:has(ytm-shorts-lockup-view-model)",
  "ytd-item-section-renderer:has(grid-shelf-view-model ytm-shorts-lockup-view-model)",
  "ytm-reel-shelf-renderer",
  'yt-tab-shape[tab-title="Shorts"]',
  "ytm-pivot-bar-item-renderer:has(.pivot-shorts)",
];

export const TWITCH_AD_SELECTORS = [
  ".stream-display-ad__wrapper",
  ".stream-display-ad__container",
  '[data-test-selector="sda-wrapper"]',
  '[data-a-target="outstream-ax-overlay"]',
  'div[data-test-selector="ad-banner-default-text-area"]',
];
