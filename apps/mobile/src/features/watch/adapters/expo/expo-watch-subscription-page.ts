import * as Linking from "expo-linking";

import type { WatchSubscriptionPageOpener } from "../../capabilities/watch-subscription-page";

export function twitchSubscriptionPageUrl(channelLogin: string): string {
  return `https://subs.twitch.tv/${encodeURIComponent(channelLogin)}`;
}

export function createExpoWatchSubscriptionPageOpener(): WatchSubscriptionPageOpener {
  return {
    async open({ channelLogin }) {
      await Linking.openURL(twitchSubscriptionPageUrl(channelLogin));
    },
  };
}
