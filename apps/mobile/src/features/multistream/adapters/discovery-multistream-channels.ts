import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import type { MultistreamChannelReader } from "../capabilities/multistream";

export function createDiscoveryMultistreamChannels(
  discovery: DiscoverySession,
): MultistreamChannelReader {
  return {
    async find(platform, login, signal) {
      const outcome = await discovery.search({
        platform,
        query: login,
        signal,
      });
      const channel = outcome.catalog.channels.find(
        (item) => item.username.toLowerCase() === login,
      );
      const live = outcome.catalog.streams.find(
        (item) => item.channelName.toLowerCase() === login,
      );
      if (live)
        return {
          platform,
          channelId: live.channelId,
          channelName: live.channelName,
        };
      if (!channel || signal.aborted) return null;
      const page = await discovery.readChannel({
        channel: { platform, id: channel.id, username: channel.username },
        signal,
      });
      return page.live && !signal.aborted
        ? {
            platform,
            channelId: page.live.channelId,
            channelName: page.live.channelName,
          }
        : null;
    },
  };
}
