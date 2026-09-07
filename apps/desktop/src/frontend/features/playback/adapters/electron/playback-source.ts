import type { PlaybackSourceResolver } from "../../capabilities/playback-source";

export const desktopPlaybackSource: PlaybackSourceResolver = {
  isAvailable: () => typeof window !== "undefined" && Boolean(window.electronAPI),
  async resolve({ platform, identifier, intent }) {
    if (!window.electronAPI) throw new Error("Electron API not available");
    const result = await window.electronAPI.streams.getPlaybackUrl({
      platform,
      channelSlug: identifier,
      intent,
    });
    if (!result.success || !result.data) {
      throw new Error(result.error || "Failed to get stream playback URL");
    }
    const { url, format } = result.data;
    if (format !== "hls" && format !== "dash" && format !== "mp4") {
      throw new Error("Backend returned an unsupported playback format");
    }
    return { url, format };
  },
};
