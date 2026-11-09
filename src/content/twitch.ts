// Twitch stitches ads into the live stream itself, so they can't be filtered out like page ads.
// Calmview does the next best thing: mutes the ad break and restores the sound when the stream returns.
import { toast } from "./toast";

const AD = '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]';

export function startTwitch(onSkipped: () => void): void {
  let saved: boolean | null = null;
  setInterval(() => {
    const video = document.querySelector<HTMLVideoElement>("video");
    const ad = !!document.querySelector(AD);
    if (ad && video && saved === null) {
      saved = video.muted;
      video.muted = true;
      onSkipped();
      toast("Ad break muted. Sound comes back when the stream does.");
    } else if (!ad && video && saved !== null) {
      video.muted = saved;
      saved = null;
    }
  }, 500);
}
