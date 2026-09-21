import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import {
  TWITCH_PLAYLIST_PROXY_SETTING_KEY,
  type TwitchPlaylistProxyPreferences,
} from "../capabilities/twitch-playlist-proxy";
import { serializeTwitchPlaylistProxyPreferences } from "../domain/twitch-playlist-proxy-preferences";

export function createTwitchPlaylistProxyStore(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): {
  read(): Promise<string | null>;
  write(value: TwitchPlaylistProxyPreferences): Promise<void>;
} {
  const now = input.now ?? Date.now;
  return {
    read() {
      return input.settings.read(TWITCH_PLAYLIST_PROXY_SETTING_KEY);
    },
    write(value) {
      return input.settings.write(
        TWITCH_PLAYLIST_PROXY_SETTING_KEY,
        serializeTwitchPlaylistProxyPreferences(value),
        now(),
      );
    },
  };
}
