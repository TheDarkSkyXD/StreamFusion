import { describe, expect, it, vi } from "vitest";

import { KickLiveNotificationSource } from "@/backend/services/kick-live-notification-source";
import type { UnifiedStream } from "@/backend/api/unified/platform-types";
import type { LocalFollow } from "@/shared/auth-types";

function follow(overrides: Partial<LocalFollow> = {}): LocalFollow {
  return {
    id: "follow-kick-alpha",
    platform: "kick",
    channelId: "101",
    channelName: "alpha",
    displayName: "Alpha",
    profileImage: "https://example.com/alpha.png",
    followedAt: "2026-01-01T00:00:00.000Z",
    source: "guest",
    ...overrides,
  };
}

function stream(slug: string, overrides: Partial<UnifiedStream> = {}): UnifiedStream {
  return {
    id: `stream-${slug}`,
    platform: "kick",
    channelId: `channel-${slug}`,
    channelName: slug,
    channelDisplayName: slug.toUpperCase(),
    channelAvatar: `https://example.com/${slug}.png`,
    title: `${slug} live`,
    viewerCount: 10,
    thumbnailUrl: "",
    isLive: true,
    startedAt: "2026-07-01T00:00:00.000Z",
    language: "en",
    tags: [],
    ...overrides,
  };
}

// Guards: Kick live notification polling must use bounded public-slug lookups so guest follows are covered without unbounded fan-out or bypassing endpoint cache/stagger behavior.
describe("KickLiveNotificationSource", () => {
  it("polls Kick follows through bounded, staggered public slug lookups", async () => {
    let active = 0;
    let maxActive = 0;
    const blockers: Array<() => void> = [];
    const getPublicStreamBySlug = vi.fn(async (slug: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => blockers.push(resolve));
      active -= 1;
      return stream(slug);
    });
    const source = new KickLiveNotificationSource({
      getPublicStreamBySlug,
      maxConcurrency: 2,
      staggerStepMs: 250,
    });

    const poll = source.poll([
      follow({ channelName: "alpha" }),
      follow({ id: "follow-bravo", channelId: "102", channelName: "bravo" }),
      follow({ id: "follow-charlie", channelId: "103", channelName: "charlie" }),
    ]);

    await vi.waitFor(() => expect(getPublicStreamBySlug).toHaveBeenCalledTimes(2));
    blockers.shift()?.();
    await vi.waitFor(() => expect(getPublicStreamBySlug).toHaveBeenCalledTimes(3));
    blockers.splice(0).forEach((resolve) => resolve());

    const result = await poll;

    expect(maxActive).toBe(2);
    expect(getPublicStreamBySlug).toHaveBeenNthCalledWith(1, "alpha", 0, undefined);
    expect(getPublicStreamBySlug).toHaveBeenNthCalledWith(2, "bravo", 250, undefined);
    expect(getPublicStreamBySlug).toHaveBeenNthCalledWith(3, "charlie", 500, undefined);
    expect(result.map((item) => item.channelName)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("serves the last live result when a transient lookup throws", async () => {
    const live = stream("alpha");
    const getPublicStreamBySlug = vi
      .fn()
      .mockResolvedValueOnce(live)
      .mockRejectedValueOnce(new Error("TRANSIENT:timeout"));
    const source = new KickLiveNotificationSource({ getPublicStreamBySlug });

    const first = await source.poll([follow({ channelName: "alpha" })]);
    const second = await source.poll([follow({ channelName: "alpha" })]);

    expect(first).toEqual([live]);
    expect(second).toEqual([live]);
  });

  it("dedupes duplicate Kick slugs before polling", async () => {
    const getPublicStreamBySlug = vi.fn(async (slug: string) => stream(slug));
    const source = new KickLiveNotificationSource({ getPublicStreamBySlug });

    const result = await source.poll([
      follow({ id: "guest-alpha", source: "guest", channelName: "Alpha" }),
      follow({ id: "kick-alpha", source: "kick", channelName: "alpha" }),
    ]);

    expect(getPublicStreamBySlug).toHaveBeenCalledTimes(1);
    expect(getPublicStreamBySlug).toHaveBeenCalledWith("Alpha", 0, undefined);
    expect(result.map((item) => item.channelName)).toEqual(["Alpha"]);
  });

  it("dispatches relay-ready Kick live events through online and offline callbacks", () => {
    const onOnline = vi.fn();
    const onOffline = vi.fn();
    const source = new KickLiveNotificationSource({
      getPublicStreamBySlug: vi.fn(),
      onOnline,
      onOffline,
    });

    source.dispatchRelayEvent({
      type: "online",
      channelId: "101",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Relay live",
    });
    source.dispatchRelayEvent({
      type: "offline",
      channelId: "101",
      channelName: "alpha",
    });

    expect(onOnline).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "101",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Relay live",
    });
    expect(onOffline).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "101",
      channelName: "alpha",
    });
  });
});
