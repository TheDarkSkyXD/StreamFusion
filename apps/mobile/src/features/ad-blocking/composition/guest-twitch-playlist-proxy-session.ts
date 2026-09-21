import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import type {
  TwitchPlaylistProxyPreferences,
  TwitchPlaylistProxySession,
  TwitchPlaylistProxyView,
} from "../capabilities/twitch-playlist-proxy";
import { createTwitchPlaylistProxyStore } from "../data/twitch-playlist-proxy-store";
import {
  composeTwitchPlaylistProxyView,
  parseTwitchPlaylistProxyPreferences,
} from "../domain/twitch-playlist-proxy-preferences";

export function createTwitchPlaylistProxySession(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): TwitchPlaylistProxySession {
  const store = createTwitchPlaylistProxyStore({
    ...(input.now === undefined ? {} : { now: input.now }),
    settings: input.settings,
  });

  async function preferences(): Promise<TwitchPlaylistProxyPreferences> {
    return parseTwitchPlaylistProxyPreferences(await store.read());
  }

  async function snapshotView(): Promise<TwitchPlaylistProxyView> {
    return composeTwitchPlaylistProxyView(await preferences());
  }

  return {
    load: snapshotView,
    async save(next: TwitchPlaylistProxyPreferences) {
      await store.write(next);
      return snapshotView();
    },
    snapshot: preferences,
  };
}
