import { describe, expect, it } from "vitest";

import type { TwitchPlaylistProxySource } from "@shared/auth-types";
import {
  getEnabledTwitchPlaylistProxySources,
  isTwitchPlaylistProxyMode,
  isTwitchPlaylistProxyOnlineResponse,
  isTwitchPlaylistProxyTemplate,
  moveTwitchPlaylistProxySource,
  resolveTwitchPlaylistProxyPingUrl,
  resolveTwitchPlaylistProxyUrl,
} from "@/features/playback/utils/twitch-playlist-proxy";

const source: TwitchPlaylistProxySource = {
  id: "eu",
  url: "eu.luminous.dev/live/$channel?fast_bread=false",
  enabled: true,
  addQueryParams: true,
};

// Guards: playlist sources preserve user order, skip disabled or malformed entries, and route only valid `$channel` templates.
// Guards: proxy URLs encode channel names, keep playback query flags idempotent, and use `/ping` only for advisory health.
describe("twitch playlist proxy utilities", () => {
  it("resolves a source template with the playback query flags exactly once", () => {
    expect(resolveTwitchPlaylistProxyUrl(source, "A Channel")).toBe(
      "https://eu.luminous.dev/live/A%20Channel?fast_bread=false&allow_source=true&allow_audio_only=true"
    );
  });

  it("resolves a channel placeholder in the query string", () => {
    expect(isTwitchPlaylistProxyTemplate("https://example.com/live?channel=$channel")).toBe(true);
    expect(
      resolveTwitchPlaylistProxyUrl(
        { ...source, url: "https://example.com/live?channel=$channel", addQueryParams: false },
        "A Channel"
      )
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
      })
    ).toBe(true);
  });

  it("treats any boolean online field as a reachable health response", () => {
    expect(isTwitchPlaylistProxyOnlineResponse({ online: true })).toBe(true);
    expect(isTwitchPlaylistProxyOnlineResponse({ online: false })).toBe(true);
    expect(isTwitchPlaylistProxyOnlineResponse({ status: "online" })).toBe(false);
  });
});
