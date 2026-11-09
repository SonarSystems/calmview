// YouTube, isolated world. The page-world layer (src/main/youtube.ts) removes ad slots before the
// player sees them; this half catches whatever still gets through:
//   - a video ad that plays anyway is muted, run at 16× and its Skip button pressed,
//   - YouTube's "ad blockers aren't allowed" dialog is closed and the video resumed,
//   - (opt-in) sponsor segments from SponsorBlock are skipped, with Undo.
import { toast } from "./toast";

interface Cfg {
  ads: boolean;
  skipSponsors: boolean;
}

const SKIP = ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, .ytp-ad-skip-button-container button";

function mainVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("#movie_player video, .html5-video-player video");
}

export function startYouTube(cfg: Cfg, onSkipped: () => void): void {
  if (cfg.ads) adSkipper(onSkipped);
  if (cfg.skipSponsors) sponsorSkipper();
}

function adSkipper(onSkipped: () => void): void {
  let saved: { muted: boolean; rate: number } | null = null;
  const tick = () => {
    const player = document.querySelector("#movie_player, .html5-video-player");
    const video = mainVideo();
    const ad = !!player && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"));
    if (ad && video) {
      if (!saved) {
        saved = { muted: video.muted, rate: video.playbackRate };
        onSkipped();
      }
      video.muted = true;
      try {
        if (video.playbackRate !== 16) video.playbackRate = 16;
      } catch {
        /* some streams cap the rate */
      }
      for (const b of document.querySelectorAll<HTMLElement>(SKIP)) b.click();
    } else if (saved && video) {
      video.muted = saved.muted;
      video.playbackRate = saved.rate === 16 ? 1 : saved.rate;
      saved = null;
    }
    // The enforcement dialog pauses the video; close it and carry on.
    const wall = document.querySelector("ytd-enforcement-message-view-model");
    if (wall) {
      wall.closest("tp-yt-paper-dialog")?.remove();
      wall.remove();
      document.querySelector("tp-yt-iron-overlay-backdrop")?.remove();
      if (video?.paused) void video.play().catch(() => undefined);
    }
  };
  // Media events don't bubble, but a capturing listener on the document still sees them.
  for (const ev of ["timeupdate", "playing", "loadedmetadata"]) document.addEventListener(ev, tick, true);
  setInterval(tick, 500);
}

interface Segment {
  start: number;
  end: number;
  category: string;
}

const LABEL: Record<string, string> = { sponsor: "sponsor", selfpromo: "self-promotion", interaction: "subscribe reminder" };

function videoId(): string {
  const u = new URL(location.href);
  return u.searchParams.get("v") ?? /^\/(?:shorts|live|embed)\/([\w-]+)/.exec(u.pathname)?.[1] ?? "";
}

function sponsorSkipper(): void {
  let id = "";
  let segments: Segment[] = [];
  const done = new Set<Segment>();
  const load = (vid: string) => {
    id = vid;
    segments = [];
    done.clear();
    if (!vid) return;
    chrome.runtime
      .sendMessage({ type: "sponsor", videoId: vid })
      .then((s: Segment[] | undefined) => {
        if (id === vid && Array.isArray(s)) segments = s;
      })
      .catch(() => undefined);
  };
  document.addEventListener(
    "timeupdate",
    (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || v !== mainVideo()) return;
      const vid = videoId();
      if (vid !== id) return load(vid);
      if (document.querySelector("#movie_player.ad-showing")) return;
      const t = v.currentTime;
      for (const s of segments) {
        if (done.has(s) || t < s.start || t >= s.end - 0.3) continue;
        done.add(s);
        const from = t;
        v.currentTime = s.end;
        const secs = Math.round(s.end - s.start);
        toast(`Skipped ${LABEL[s.category] ?? "a segment"} (${secs}s)`, { label: "Undo", run: () => void (v.currentTime = from) });
      }
    },
    true,
  );
  load(videoId());
}
