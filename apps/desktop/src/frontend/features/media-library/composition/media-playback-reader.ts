import type { MediaPlaybackReader } from "../capabilities/media-playback-reader";
import { electronMediaPlaybackReader } from "../adapters/electron/media-playback-reader";

/** Resolve the desktop media reader when a history action is invoked. */
export function getMediaPlaybackReader(): MediaPlaybackReader | undefined {
  return typeof window !== "undefined" && window.electronAPI
    ? electronMediaPlaybackReader
    : undefined;
}
