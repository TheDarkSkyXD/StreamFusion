import type { DiscoveryMediaReader } from "../../capabilities/discovery-media-reader";

export const desktopDiscoveryMediaReader: DiscoveryMediaReader = {
  videos: {
    getByChannel: (request) => window.electronAPI.videos.getByChannel(request),
    getByCategory: (request) => window.electronAPI.videos.getByCategory(request),
  },
  clips: {
    getByChannel: (request) => window.electronAPI.clips.getByChannel(request),
    getByCategory: (request) => window.electronAPI.clips.getByCategory(request),
    getPlaybackUrl: (request) => window.electronAPI.clips.getPlaybackUrl(request),
  },
};
