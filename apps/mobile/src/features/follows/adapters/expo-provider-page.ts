import * as Linking from "expo-linking";
import type { Platform } from "@streamfusion/core/platform";

import type { ProviderPageOpener } from "../capabilities/following-session";

export function providerPageUrl(input: {
  readonly platform: Platform;
  readonly channelLogin: string;
}): string {
  const login = encodeURIComponent(input.channelLogin);
  return input.platform === "twitch"
    ? `https://twitch.tv/${login}`
    : `https://kick.com/${login}`;
}

export function createExpoProviderPageOpener(): ProviderPageOpener {
  return {
    async open(input) {
      await Linking.openURL(providerPageUrl(input));
    },
  };
}
