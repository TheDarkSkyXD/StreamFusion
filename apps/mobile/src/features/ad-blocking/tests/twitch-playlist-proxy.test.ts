import { describe, expect, it } from "vitest";

import type { TwitchPlaylistProxySource } from "../capabilities/twitch-playlist-proxy";
import {
  getEnabledTwitchPlaylistProxySources,
  isTwitchPlaylistProxyMode,
  isTwitchPlaylistProxyOnlineResponse,
  isTwitchPlaylistProxyTemplate,
  moveTwitchPlaylistProxySource,
  resolveTwitchPlaylistProxyAttemptUrls,
  resolveTwitchPlaylistProxyPingUrl,
  resolveTwitchPlaylistProxyUrl,
} from "../domain/twitch-playlist-proxy";
import {
  DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
  parseTwitchPlaylistProxyPreferences,
} from "../domain/twitch-playlist-proxy-preferences";
import { createTwitchPlaylistProxySession } from "../composition/guest-twitch-playlist-proxy-session";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import { createAdBlockSession } from "../composition/guest-adblock-session";
import type { EffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/capabilities/installation-policy";

const source: TwitchPlaylistProxySource = {
  id: "eu",
  url: "eu.luminous.dev/live/$channel?fast_bread=false",
  enabled: true,
  addQueryParams: true,
};

function memorySettings(
  initial: Record<string, string> = {},
): ProductSettingsStore {
  const values = new Map(Object.entries(initial));
  return {
    async read(key) {
      return values.get(key) ?? null;
    },
    async write(key, value, _updatedAt) {
      values.set(key, value);
    },
  };
}

describe("twitch playlist proxy utilities", () => {
  it("resolves a source template with the playback query flags exactly once", () => {
    expect(resolveTwitchPlaylistProxyUrl(source, "A Channel")).toBe(
      "https://eu.luminous.dev/live/A%20Channel?fast_bread=false&allow_source=true&allow_audio_only=true",
    );
  });

  it("resolves a channel placeholder in the query string", () => {
    expect(isTwitchPlaylistProxyTemplate("https://example.com/live?channel=$channel")).toBe(true);
    expect(
      resolveTwitchPlaylistProxyUrl(
        { ...source, url: "https://example.com/live?channel=$channel", addQueryParams: false },
        "A Channel",
      ),
    ).toBe("https://example.com/live?channel=A%20Channel");
  });

  it("builds the status endpoint without leaking playlist parameters", () => {
    expect(resolveTwitchPlaylistProxyPingUrl(source)).toBe("https://eu.luminous.dev/ping");
  });

  it("keeps only enabled templates in their configured order", () => {
    const sources = getEnabledTwitchPlaylistProxySources([
      { ...source, id: "first" },
      { ...source, id: "disabled", enabled: false },
      { ...source, id: "invalid", url: "https://example.com/live/channel" },
      { ...source, id: "last", url: "https://last.example/live/$channel" },
    ]);

    expect(sources.map((candidate) => candidate.id)).toEqual(["first", "last"]);
    expect(isTwitchPlaylistProxyTemplate("ftp://example.com/$channel")).toBe(false);
  });

  it("moves a source within the fallback order without mutating the input", () => {
    const sources = [
      { ...source, id: "first" },
      { ...source, id: "second" },
      { ...source, id: "third" },
    ];

    expect(moveTwitchPlaylistProxySource(sources, "third", "first").map(({ id }) => id)).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect(sources.map(({ id }) => id)).toEqual(["first", "second", "third"]);
  });

  it("keeps proxy mode off until preferences have loaded", () => {
    expect(isTwitchPlaylistProxyMode(null)).toBe(false);
    expect(
      isTwitchPlaylistProxyMode({
        twitchPlaylistProxy: { enabled: true, sources: [] },
      }),
    ).toBe(true);
  });

  it("treats any boolean online field as a reachable health response", () => {
    expect(isTwitchPlaylistProxyOnlineResponse({ online: true })).toBe(true);
    expect(isTwitchPlaylistProxyOnlineResponse({ online: false })).toBe(true);
    expect(isTwitchPlaylistProxyOnlineResponse({ status: "online" })).toBe(false);
  });

  it("matches desktop defaults including enabled-on luminous sources", () => {
    expect(DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES.enabled).toBe(true);
    expect(DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES.sources.length).toBeGreaterThan(0);
    expect(parseTwitchPlaylistProxyPreferences(null)).toEqual(
      DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
    );
  });

  it("lists resolved attempt URLs in fallback order", () => {
    expect(
      resolveTwitchPlaylistProxyAttemptUrls(
        {
          enabled: true,
          sources: [
            { ...source, id: "first" },
            { ...source, id: "second", enabled: false },
            { ...source, id: "third", url: "https://third.example/live/$channel", addQueryParams: false },
          ],
        },
        "xqc",
      ),
    ).toEqual([
      "https://eu.luminous.dev/live/xqc?fast_bread=false&allow_source=true&allow_audio_only=true",
      "https://third.example/live/xqc",
    ]);
  });
});

describe("twitch playlist proxy session and adblock passthrough", () => {
  it("persists twitchPlaylistProxy preferences", async () => {
    const settings = memorySettings();
    const session = createTwitchPlaylistProxySession({ settings });
    const view = await session.load();
    expect(view.enabled).toBe(true);
    await session.save({ enabled: false, sources: [] });
    await expect(session.snapshot()).resolves.toEqual({ enabled: false, sources: [] });
  });

  it("forces AdBlockSession effective mode to passthrough when proxy mode is on", async () => {
    const settings = memorySettings();
    const playlistProxy = createTwitchPlaylistProxySession({ settings });
    const policy: EffectiveCapabilityPolicyReader = {
      read: async () => ({
        kind: "enabled",
        sequence: 1,
        verifiedAtEpochMs: 1,
      }),
    };
    const adblock = createAdBlockSession({
      playlistProxy,
      policy,
      settings,
    });
    await expect(adblock.effective("twitch")).resolves.toEqual({
      enabled: false,
      mode: "passthrough",
      platform: "twitch",
    });
    await playlistProxy.save({ enabled: false, sources: [] });
    await expect(adblock.effective("twitch")).resolves.toEqual({
      enabled: true,
      mode: "strip",
      platform: "twitch",
    });
  });
});
