import * as Linking from "expo-linking";

import type {
  WatchProviderPagePort,
  WatchTarget,
} from "../capabilities/watch";

export function createExpoWatchProviderFallback(): WatchProviderPagePort {
  return {
    async open(target: WatchTarget) {
      const path = encodeURIComponent(target.channelName);
      const url =
        target.platform === "twitch"
          ? `https://www.twitch.tv/${path}`
          : `https://kick.com/${path}`;
      try {
        await Linking.openURL(url);
        return { kind: "opened" as const };
      } catch {
        return {
          detail: "Could not open the provider page.",
          kind: "unavailable" as const,
        };
      }
    },
  };
}
