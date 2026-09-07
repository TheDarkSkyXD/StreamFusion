import type { MediaPlaybackReader } from "../../capabilities/media-playback-reader";

type MediaBridge = typeof window.electronAPI;

/** Electron implementation of history playback validation and resolution. */
export const electronMediaPlaybackReader = {
  getChannelClips: (...args: Parameters<MediaBridge["clips"]["getByChannel"]>) =>
    window.electronAPI.clips.getByChannel(...args),
  getVideoPlaybackUrl: (...args: Parameters<MediaBridge["videos"]["getPlaybackUrl"]>) =>
    window.electronAPI.videos.getPlaybackUrl(...args),
  getClipPlaybackUrl: (...args: Parameters<MediaBridge["clips"]["getPlaybackUrl"]>) =>
    window.electronAPI.clips.getPlaybackUrl(...args),
} satisfies MediaPlaybackReader;
