import { describe, expect, it } from "vitest";

import { createFetchPlaylistProxyHealth } from "../adapters/fetch-playlist-proxy-health";
import type { TwitchPlaylistProxySource } from "../capabilities/twitch-playlist-proxy";

const source: TwitchPlaylistProxySource = {
  addQueryParams: true,
  enabled: true,
  id: "test",
  url: "https://example.com/live/$channel?token=private",
};

describe("playlist proxy health", () => {
  it("checks the source ping path and interprets online false as offline", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      urls.push(String(input));
      return Response.json({ online: false });
    };
    const health = createFetchPlaylistProxyHealth(fetcher);
    await expect(
      health.check(source, new AbortController().signal),
    ).resolves.toBe("offline");
    expect(urls).toEqual(["https://example.com/ping"]);
  });

  it("reports online only for a successful online ping", async () => {
    const fetcher: typeof fetch = async () => Response.json({ online: true });
    const health = createFetchPlaylistProxyHealth(fetcher);
    await expect(
      health.check(source, new AbortController().signal),
    ).resolves.toBe("online");
  });
});
