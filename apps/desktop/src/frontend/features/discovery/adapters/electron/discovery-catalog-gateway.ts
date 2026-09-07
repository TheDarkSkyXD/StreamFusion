type DiscoveryBridge = typeof window.electronAPI;

export const discoveryCatalogGateway = {
  categories: {
    getTop: (...args: Parameters<DiscoveryBridge["categories"]["getTop"]>) =>
      window.electronAPI.categories.getTop(...args),
    getMetadata: (...args: Parameters<DiscoveryBridge["categories"]["getMetadata"]>) =>
      window.electronAPI.categories.getMetadata(...args),
    search: (...args: Parameters<DiscoveryBridge["categories"]["search"]>) =>
      window.electronAPI.categories.search(...args),
    getById: (...args: Parameters<DiscoveryBridge["categories"]["getById"]>) =>
      window.electronAPI.categories.getById(...args),
  },
  streams: {
    getTop: (...args: Parameters<DiscoveryBridge["streams"]["getTop"]>) =>
      window.electronAPI.streams.getTop(...args),
    getFollowed: (...args: Parameters<DiscoveryBridge["streams"]["getFollowed"]>) =>
      window.electronAPI.streams.getFollowed(...args),
    getByChannel: (...args: Parameters<DiscoveryBridge["streams"]["getByChannel"]>) =>
      window.electronAPI.streams.getByChannel(...args),
    getByCategory: (...args: Parameters<DiscoveryBridge["streams"]["getByCategory"]>) =>
      window.electronAPI.streams.getByCategory(...args),
  },
  channels: {
    getFollowed: (...args: Parameters<DiscoveryBridge["channels"]["getFollowed"]>) =>
      window.electronAPI.channels.getFollowed(...args),
    getByUsername: (...args: Parameters<DiscoveryBridge["channels"]["getByUsername"]>) =>
      window.electronAPI.channels.getByUsername(...args),
  },
};
