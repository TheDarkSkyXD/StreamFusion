import type { DiscoverySearchSession } from "../../capabilities/search-session";

type DiscoveryBridge = typeof window.electronAPI;

export const discoverySearchSessionGateway = {
  streams: async (...args: Parameters<DiscoveryBridge["search"]["streams"]>) => {
    const result = await window.electronAPI.search.streams(...args);
    return { ...result, error: result.error ?? null };
  },
  videos: async (...args: Parameters<DiscoveryBridge["search"]["videos"]>) => {
    const result = await window.electronAPI.search.videos(...args);
    return { ...result, error: result.error ?? null };
  },
  clips: async (...args: Parameters<DiscoveryBridge["search"]["clips"]>) => {
    const result = await window.electronAPI.search.clips(...args);
    return { ...result, error: result.error ?? null };
  },
  channels: (...args: Parameters<DiscoveryBridge["search"]["channels"]>) =>
    window.electronAPI.search.channels(...args),
  all: (...args: Parameters<DiscoveryBridge["search"]["all"]>) =>
    window.electronAPI.search.all(...args),
  cancel: (...args: Parameters<DiscoveryBridge["search"]["cancel"]>) =>
    window.electronAPI.search.cancel(...args),
} satisfies DiscoverySearchSession;
