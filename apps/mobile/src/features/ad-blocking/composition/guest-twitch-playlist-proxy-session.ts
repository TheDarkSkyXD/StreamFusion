import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import type { PlaybackFiltering } from "../capabilities/ad-blocking";

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
  readonly customFiltering?: PlaybackFiltering;
  readonly settings: ProductSettingsStore;
}): TwitchPlaylistProxySession {
  const store = createTwitchPlaylistProxyStore({
    ...(input.now === undefined ? {} : { now: input.now }),
    settings: input.settings,
  });
  async function customEnabled(): Promise<boolean> {
    if (!input.customFiltering) return false;
    const request = await input.customFiltering.effective("twitch");
    return request.enabled && request.mode !== "passthrough";
  }

  async function preferences(): Promise<TwitchPlaylistProxyPreferences> {
    const [rawProxy, isCustomEnabled] = await Promise.all([
      store.read(),
      customEnabled(),
    ]);
    const proxy = parseTwitchPlaylistProxyPreferences(rawProxy);
    if (!isCustomEnabled || !proxy.enabled) return proxy;
    return { ...proxy, enabled: false };
  }

  async function snapshotView(): Promise<TwitchPlaylistProxyView> {
    return composeTwitchPlaylistProxyView(await preferences());
  }

  return {
    load: snapshotView,
    async save(next: TwitchPlaylistProxyPreferences) {
      await store.write(
        (await customEnabled()) ? { ...next, enabled: false } : next,
      );
      return snapshotView();
    },
    snapshot: preferences,
  };
}
