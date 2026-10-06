import { describe, expect, it, vi } from "vitest";

import { createTwitchChannelBadgeCatalogReader } from "../adapters/twitch-channel-badge-catalog";
import { resolveWatchChatBadges } from "../domain/resolve-chat-badges";
import type { WatchChatConnectInput } from "../capabilities/watch-chat";

const target = (id: string): WatchChatConnectInput => ({
  platform: "twitch",
  channelId: id,
  channelName: `room${id}`,
});
const badge = {
  setID: "subscriber",
  version: "12",
  title: "1-Year Subscriber",
  imageURL: "https://static-cdn.jtvnw.net/badges/v1/channel/3",
};
const response = () =>
  Response.json({ data: { user: { broadcastBadges: [badge] } } });

describe("Twitch channel badge catalog", () => {
  it("deduplicates channel reads and resolves exact channel versions before global artwork", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const reader = createTwitchChannelBadgeCatalogReader(fetch);
    const pending = reader.read(target("1"));
    expect(reader.read(target("1"))).toBe(pending);
    const catalog = await pending;
    await reader.read(target("1"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      operationName: "UserBadges",
      variables: { id: "1", login: "room1", quality: "QUADRUPLE" },
    });
    const exact = {
      setId: "subscriber",
      version: "12",
      imageUrl: "",
      title: "subscriber",
    };
    const other = {
      setId: "subscriber",
      version: "13",
      imageUrl: "",
      title: "subscriber",
    };
    const refs = [exact, other];
    const resolved = resolveWatchChatBadges(refs, catalog, [
      { ...exact, imageUrl: "https://global/12" },
      { ...other, imageUrl: "https://global/13" },
    ]);
    expect(resolved).toEqual([
      {
        setId: "subscriber",
        version: "12",
        imageUrl: badge.imageURL,
        title: badge.title,
      },
      { ...refs[1], imageUrl: "https://global/13" },
    ]);
  });

  it("uses the desktop persisted query when the channel query fails", async () => {
    const bodies: unknown[] = [];
    const reader = createTwitchChannelBadgeCatalogReader(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return body.operationName === "UserBadges"
        ? Response.json({ errors: [{ message: "Unavailable" }] })
        : Response.json({
            data: {
              badges: [
                { ...badge, imageURL: undefined, image4x: badge.imageURL },
              ],
            },
          });
    });
    const catalog = await reader.read({
      ...target("slug"),
      channelName: "#XQC",
    });
    expect(bodies).toMatchObject([
      { variables: { login: "xqc" } },
      { operationName: "ChatList_Badges", variables: { channelLogin: "xqc" } },
    ]);
    expect(catalog.get("subscriber")?.get("12")?.imageUrl).toBe(badge.imageURL);
  });

  it("does not cache failed requests or accept unsafe badge images", async () => {
    let failing = true;
    const fetch = vi.fn(async () =>
      failing
        ? Response.json({ errors: [{ message: "Unavailable" }] })
        : Response.json({
            data: {
              user: {
                broadcastBadges: [
                  badge,
                  { ...badge, version: "18", imageURL: "http://unsafe/art" },
                ],
              },
            },
          }),
    );
    const reader = createTwitchChannelBadgeCatalogReader(fetch);
    await expect(reader.read(target("1"))).rejects.toThrow("unavailable");
    failing = false;
    const catalog = await reader.read(target("1"));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(catalog.get("subscriber")?.size).toBe(1);
  });

  it("evicts old channels and refreshes expired catalogs", async () => {
    const fetch = vi.fn(async () => response());
    const reader = createTwitchChannelBadgeCatalogReader(fetch);
    for (let index = 1; index <= 21; index += 1)
      await reader.read(target(String(index)));
    await reader.read(target("1"));
    expect(fetch).toHaveBeenCalledTimes(22);
    const now = Date.now();
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(now + 60 * 60 * 1000 + 1);
    try {
      await reader.read(target("1"));
      expect(fetch).toHaveBeenCalledTimes(23);
    } finally {
      clock.mockRestore();
    }
  });

  it("prevents an evicted late request from replacing a newer request for the same channel", async () => {
    const resolvers: ((value: Response) => void)[] = [];
    const reader = createTwitchChannelBadgeCatalogReader(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.variables.id === "1")
        return new Promise<Response>((resolve) => resolvers.push(resolve));
      return response();
    });
    const old = reader.read(target("1"));
    for (let index = 2; index <= 21; index += 1)
      await reader.read(target(String(index)));
    const fresh = reader.read(target("1"));
    resolvers[0]?.(response());
    await old;
    expect(reader.read(target("1"))).toBe(fresh);
    resolvers[1]?.(response());
    await fresh;
  });
});
