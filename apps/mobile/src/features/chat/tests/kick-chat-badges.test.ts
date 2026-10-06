import { describe, expect, it, vi } from "vitest";

import { getBundledBadgeUrl } from "../utils/kick-badge-assets";
import { createKickBadgeCatalogReader } from "../adapters/kick-badge-catalog";
import type { WatchChatConnectInput } from "../capabilities/watch-chat";
import {
  parseKickIdentityBadges,
  parseKickSubscriberCatalog,
  resolveKickChatBadges,
} from "../domain/kick-chat-badges";
import { parseKickChatFrame } from "../domain/watch-chat-messages";

const target = (name: string): WatchChatConnectInput => ({
  platform: "kick",
  channelId: "5312671",
  channelName: name,
});
const channelBody = {
  subscriber_badges: [
    {
      months: 1,
      badge_image: {
        src: "https://files.kick.com/channel_subscriber_badges/one.png",
      },
    },
    {
      months: 12,
      badge_image: { src: "https://cdn.example.org/channel/twelve.png" },
    },
    {
      months: 24,
      badge_image: { src: "https://cdn.example.org/channel/twenty-four.png" },
    },
  ],
};
const channel = () => Response.json(channelBody);

describe("Kick chat badges", () => {
  it("maps native identity roles and count-tiered gift art in live and history parser", () => {
    const message = parseKickChatFrame(
      {
        id: "k1",
        content: "hello",
        sender: {
          slug: "spreen",
          username: "Spreen",
          identity: {
            badges: [
              { type: "broadcaster", text: "Broadcaster" },
              { type: "moderator", text: "Moderator" },
              { type: "subscriber", count: 14, text: "Subscriber" },
              { type: "sub_gifter", count: 50, text: "Sub gifter" },
            ],
          },
        },
      },
      getBundledBadgeUrl,
    );
    expect(message?.badges).toMatchObject([
      {
        setId: "broadcaster",
        title: "Broadcaster",
        imageUrl: getBundledBadgeUrl("broadcaster"),
      },
      {
        setId: "moderator",
        title: "Moderator",
        imageUrl: getBundledBadgeUrl("moderator"),
      },
      { setId: "subscriber", version: "14", title: "14-Month Subscriber" },
      { setId: "sub_gifter", version: "50", title: "Gifted 50 subs" },
    ]);
    expect(message?.badges[3]?.imageUrl).toBe(
      getBundledBadgeUrl("sub_gifter", 50),
    );
  });

  it("selects the highest channel tier at or below the user's months and preserves other artwork", () => {
    const badges = parseKickIdentityBadges(
      [
        { type: "subscriber", count: 14 },
        { type: "vip", image_url: "https://cdn.example.org/vip.png" },
      ],
      getBundledBadgeUrl,
    );
    const resolved = resolveKickChatBadges(
      badges,
      parseKickSubscriberCatalog(channelBody),
    );
    expect(resolved[0]).toMatchObject({
      version: "14",
      title: "14-Month Subscriber",
      imageUrl: "https://cdn.example.org/channel/twelve.png",
    });
    expect(resolved[1]).toEqual(badges[1]);
  });

  it("rejects malformed and unsafe channel art while keeping valid HTTPS provider CDNs", () => {
    const catalog = parseKickSubscriberCatalog({
      subscriber_badges: [
        {
          months: 1,
          badge_image: { src: "http://insecure.example/badge.png" },
        },
        { months: 2, badge_image: { src: "javascript:alert(1)" } },
        {
          months: 3,
          badge_image: { src: "https://cdn.example.org/three.png" },
        },
        {
          months: -1,
          badge_image: { src: "https://cdn.example.org/invalid.png" },
        },
      ],
    });
    expect([...(catalog.get("subscriber")?.keys() ?? [])]).toEqual(["3"]);
    expect(catalog.get("subscriber")?.get("3")?.imageUrl).toBe(
      "https://cdn.example.org/three.png",
    );
  });
});

describe("Kick subscriber badge reader", () => {
  it("deduplicates channel reads, caches results, and expires after one hour", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => channel());
    const reader = createKickBadgeCatalogReader(fetch);
    const first = reader.read(target("Spreen"));
    expect(reader.read(target("spreen"))).toBe(first);
    expect((await first).get("subscriber")?.get("12")?.imageUrl).toBe(
      "https://cdn.example.org/channel/twelve.png",
    );
    await reader.read(target("spreen"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain("/spreen");
    const now = Date.now();
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(now + 60 * 60 * 1000 + 1);
    try {
      await reader.read(target("spreen"));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
      reader.dispose?.();
    }
  });

  it("evicts failures and bounds an unresponsive request", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementationOnce(() => new Promise<Response>(() => undefined))
        .mockImplementationOnce(async () => channel());
      const reader = createKickBadgeCatalogReader(fetch);
      const first = reader.read(target("spreen"));
      const assertion = expect(first).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(
        (await reader.read(target("spreen"))).get("subscriber")?.size,
      ).toBe(3);
      expect(fetch).toHaveBeenCalledTimes(2);
      reader.dispose?.();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
