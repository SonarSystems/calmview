// Entry for youtube-main.js (MAIN world, document_start, YouTube hosts only).
import { installYouTube } from "./youtube";

if (!(window as unknown as { __hushYT?: boolean }).__hushYT) {
  Object.defineProperty(window, "__hushYT", { value: true });
  installYouTube();
}
