import { beforeEach, describe, expect, it, vi } from "vitest";

const persistedValues = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/backend/services/database-service", () => ({
  dbService: {
    get: vi.fn((key: string) => persistedValues.get(key) ?? null),
    set: vi.fn((key: string, value: unknown) => {
      persistedValues.set(key, structuredClone(value));
    }),
  },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getLocalFollowsByPlatform: vi.fn(),
    updateLocalFollow: vi.fn(),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { dbService } from "@/backend/services/database-service";
import { repairKickFollowSlugs } from "@/backend/services/kick-follow-metadata-repair";
import { storageService } from "@/backend/services/storage-service";
import type { LocalFollow } from "@/shared/auth-types";

function makeFollow(overrides: Partial<LocalFollow> = {}): LocalFollow {
  return {
    id: "row-henny",
    platform: "kick",
    channelId: "21103818",
    channelName: "hennythingz1",
    displayName: "Hennythingz1",
    profileImage: "https://example.com/old-henny.webp",
    followedAt: "2026-01-01T00:00:00.000Z",
    source: "kick",
    ...overrides,
  };
}

function makeChannel(overrides: Partial<UnifiedChannel> = {}): UnifiedChannel {
  return {
    id: "21103818",
    platform: "kick",
    username: "hennytingzz",
    displayName: "Hennytingzz",
    avatarUrl: "https://example.com/hennytingzz.webp",
    isLive: false,
    isVerified: false,
    isPartner: false,
    ...overrides,
  };
}

beforeEach(() => {
  persistedValues.clear();
  vi.clearAllMocks();
});

// Guards: verified metadata discovered during a slug repair survives later calls and process restarts under the stable Kick broadcaster ID.
describe("repairKickFollowSlugs verification metadata", () => {
  it("persists verified metadata by stable broadcaster ID and reuses it after the slug is current", async () => {
    const staleFollow = makeFollow();
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([staleFollow]);
    const getPublicChannel = vi.fn().mockResolvedValue(
      makeChannel({
        id: "20120336",
        kickUserId: "21103818",
        isVerified: true,
      })
    );
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([makeChannel()]),
      getPublicChannel,
    };

    const repaired = await repairKickFollowSlugs(client, [staleFollow]);
    expect(repaired.get(staleFollow.id)?.isVerified).toBe(true);
    expect(dbService.set).toHaveBeenCalledWith(
      "kick-follow-verification-cache-v1",
      expect.objectContaining({
        version: 1,
        entries: {
          "21103818": expect.objectContaining({ isVerified: true }),
        },
      })
    );

    const currentFollow = makeFollow({
      channelName: "hennytingzz",
      displayName: "Hennytingzz",
      profileImage: "https://example.com/hennytingzz.webp",
    });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([currentFollow]);
    getPublicChannel.mockRejectedValue(new Error("public lookup unavailable after restart"));

    const afterRestart = await repairKickFollowSlugs(client, [currentFollow]);

    expect(afterRestart.get(currentFollow.id)?.isVerified).toBe(true);
    expect(getPublicChannel).toHaveBeenCalledTimes(1);
  });

  it("backfills missing current-slug verification in bounded rotating batches", async () => {
    const follows = Array.from({ length: 5 }, (_, index) => {
      const id = String(10_000 + index);
      const slug = `current-${index}`;
      return makeFollow({
        id: `row-${index}`,
        channelId: id,
        channelName: slug,
        displayName: slug,
      });
    });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue(follows);
    const channels = follows.map((follow) =>
      makeChannel({
        id: follow.channelId,
        username: follow.channelName,
        displayName: follow.displayName,
      })
    );
    const getPublicChannel = vi.fn(async (slug: string) => {
      const follow = follows.find((candidate) => candidate.channelName === slug)!;
      return makeChannel({
        id: `legacy-${follow.channelId}`,
        kickUserId: follow.channelId,
        username: slug,
        displayName: follow.displayName,
        isVerified: true,
      });
    });
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue(channels),
      getPublicChannel,
    };

    const firstBatch = await repairKickFollowSlugs(client, follows);

    expect([...firstBatch.values()].filter((channel) => channel.isVerified)).toHaveLength(3);
    expect(getPublicChannel).toHaveBeenCalledTimes(3);

    const secondBatch = await repairKickFollowSlugs(client, follows);

    expect([...secondBatch.values()].filter((channel) => channel.isVerified)).toHaveLength(5);
    expect(getPublicChannel).toHaveBeenCalledTimes(5);
  });

  it("shares one public verification lookup across duplicate rows for the same stable broadcaster", async () => {
    const firstFollow = makeFollow({ id: "row-henny-1" });
    const duplicateFollow = makeFollow({ id: "row-henny-2" });
    const follows = [firstFollow, duplicateFollow];
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue(follows);
    const getPublicChannel = vi.fn().mockResolvedValue(
      makeChannel({
        id: "20120336",
        kickUserId: "21103818",
        isVerified: true,
      })
    );
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([makeChannel()]),
      getPublicChannel,
    };

    const repaired = await repairKickFollowSlugs(client, follows);

    expect(getPublicChannel).toHaveBeenCalledTimes(1);
    expect(repaired.get(firstFollow.id)?.isVerified).toBe(true);
    expect(repaired.get(duplicateFollow.id)?.isVerified).toBe(true);
  });

  it("serializes concurrent cache updates so entries and rotation progress are not lost", async () => {
    const makeCurrentFollows = (group: string, idBase: number) =>
      Array.from({ length: 5 }, (_, index) =>
        makeFollow({
          id: `row-${group}-${index}`,
          channelId: String(idBase + index),
          channelName: `${group}-${index}`,
          displayName: `${group} ${index}`,
        })
      );
    const firstFollows = makeCurrentFollows("first", 30_000);
    const secondFollows = makeCurrentFollows("second", 40_000);
    const allFollows = [...firstFollows, ...secondFollows];
    const channels = allFollows.map((follow) =>
      makeChannel({
        id: follow.channelId,
        username: follow.channelName,
        displayName: follow.displayName,
      })
    );
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue(allFollows);

    let releaseFirstLookup!: () => void;
    const firstLookupGate = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve;
    });
    const getPublicChannel = vi.fn(async (slug: string) => {
      if (slug === "first-0") {
        await firstLookupGate;
      }
      const channel = channels.find((candidate) => candidate.username === slug)!;
      return makeChannel({
        id: `legacy-${channel.id}`,
        kickUserId: channel.id,
        username: channel.username,
        displayName: channel.displayName,
        isVerified: true,
      });
    });
    const client = {
      getChannelsByBroadcasterIds: vi.fn(async (ids: number[]) =>
        channels.filter((channel) => ids.includes(Number(channel.id)))
      ),
      getPublicChannel,
    };

    const firstRepair = repairKickFollowSlugs(client, firstFollows);
    await vi.waitFor(() => expect(getPublicChannel).toHaveBeenCalledTimes(1));
    const secondRepair = repairKickFollowSlugs(client, secondFollows);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releaseFirstLookup();
    await Promise.all([firstRepair, secondRepair]);

    const stored = persistedValues.get("kick-follow-verification-cache-v1") as {
      nextBackfillIndex: number;
      entries: Record<string, unknown>;
    };
    expect(Object.keys(stored.entries)).toHaveLength(6);
    expect(stored.nextBackfillIndex).toBe(1);
  });

  it("allows concurrent network lookups while merging both stable-ID cache updates", async () => {
    const firstFollow = makeFollow({
      id: "row-first-network",
      channelId: "51001",
      channelName: "first-network",
      displayName: "First Network",
    });
    const secondFollow = makeFollow({
      id: "row-second-network",
      channelId: "52001",
      channelName: "second-network",
      displayName: "Second Network",
    });
    const follows = [firstFollow, secondFollow];
    const channels = follows.map((follow) =>
      makeChannel({
        id: follow.channelId,
        username: follow.channelName,
        displayName: follow.displayName,
      })
    );
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue(follows);

    let releaseFirstLookup!: () => void;
    const firstLookupGate = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve;
    });
    let markSecondOfficialReached!: () => void;
    const secondOfficialReached = new Promise<void>((resolve) => {
      markSecondOfficialReached = resolve;
    });
    const client = {
      getChannelsByBroadcasterIds: vi.fn(async (ids: number[]) => {
        if (ids.includes(52_001)) {
          markSecondOfficialReached();
        }
        return channels.filter((channel) => ids.includes(Number(channel.id)));
      }),
      getPublicChannel: vi.fn(async (slug: string) => {
        if (slug === firstFollow.channelName) {
          await firstLookupGate;
        }
        const channel = channels.find((candidate) => candidate.username === slug)!;
        return makeChannel({
          id: `legacy-${channel.id}`,
          kickUserId: channel.id,
          username: channel.username,
          displayName: channel.displayName,
          isVerified: true,
        });
      }),
    };

    const firstRepair = repairKickFollowSlugs(client, [firstFollow]);
    await vi.waitFor(() => expect(client.getPublicChannel).toHaveBeenCalledTimes(1));
    const secondRepair = repairKickFollowSlugs(client, [secondFollow]);
    const secondReachedOfficialBeforeRelease = await Promise.race([
      secondOfficialReached.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 0)),
    ]);
    releaseFirstLookup();
    await Promise.all([firstRepair, secondRepair]);

    const stored = persistedValues.get("kick-follow-verification-cache-v1") as {
      entries: Record<string, unknown>;
    };
    expect(secondReachedOfficialBeforeRelease).toBe(true);
    expect(stored.entries).toHaveProperty(firstFollow.channelId);
    expect(stored.entries).toHaveProperty(secondFollow.channelId);
  });

  it("revalidates stale verified metadata so a revoked badge is eventually removed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
      const follow = makeFollow({
        channelName: "hennytingzz",
        displayName: "Hennytingzz",
      });
      vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([follow]);
      const currentChannel = makeChannel();
      const getPublicChannel = vi
        .fn()
        .mockResolvedValueOnce(
          makeChannel({
            id: "20120336",
            kickUserId: "21103818",
            isVerified: true,
          })
        )
        .mockResolvedValueOnce(
          makeChannel({
            id: "20120336",
            kickUserId: "21103818",
            isVerified: false,
          })
        );
      const client = {
        getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([currentChannel]),
        getPublicChannel,
      };

      const seeded = await repairKickFollowSlugs(client, [follow]);
      expect(seeded.get(follow.id)?.isVerified).toBe(true);

      vi.setSystemTime(new Date("2026-07-02T00:00:00.001Z"));
      const revalidated = await repairKickFollowSlugs(client, [follow]);

      expect(revalidated.get(follow.id)?.isVerified).toBe(false);
      expect(getPublicChannel).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prioritizes a real slug change inside the bounded verification batch", async () => {
    const currentFollows = Array.from({ length: 3 }, (_, index) =>
      makeFollow({
        id: `row-current-${index}`,
        channelId: String(20_000 + index),
        channelName: `current-${index}`,
        displayName: `Current ${index}`,
      })
    );
    const renamedFollow = makeFollow({
      id: "row-renamed",
      channelId: "29999",
      channelName: "old-priority-slug",
      displayName: "Old Priority Slug",
    });
    const follows = [...currentFollows, renamedFollow];
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue(follows);
    const channels = [
      ...currentFollows.map((follow) =>
        makeChannel({
          id: follow.channelId,
          username: follow.channelName,
          displayName: follow.displayName,
        })
      ),
      makeChannel({
        id: renamedFollow.channelId,
        username: "new-priority-slug",
        displayName: "New Priority Slug",
      }),
    ];
    const getPublicChannel = vi.fn(async (slug: string) => {
      const channel = channels.find((candidate) => candidate.username === slug)!;
      return makeChannel({
        id: `legacy-${channel.id}`,
        kickUserId: channel.id,
        username: channel.username,
        displayName: channel.displayName,
        isVerified: true,
      });
    });
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue(channels),
      getPublicChannel,
    };

    const repaired = await repairKickFollowSlugs(client, follows);

    expect(getPublicChannel).toHaveBeenCalledTimes(3);
    expect(repaired.get(renamedFollow.id)?.username).toBe("new-priority-slug");
    expect(repaired.get(renamedFollow.id)?.isVerified).toBe(true);
  });

  it("rejects public verification from a different stable Kick identity", async () => {
    const staleFollow = makeFollow();
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([staleFollow]);
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([makeChannel()]),
      getPublicChannel: vi.fn().mockResolvedValue(
        makeChannel({
          id: "20120336",
          kickUserId: "99999999",
          isVerified: true,
        })
      ),
    };

    const repaired = await repairKickFollowSlugs(client, [staleFollow]);

    expect(repaired.get(staleFollow.id)).toEqual(
      expect.objectContaining({
        id: "21103818",
        username: "hennytingzz",
        isVerified: false,
      })
    );
  });

  it("rejects public verification when the stable Kick identity is absent", async () => {
    const staleFollow = makeFollow();
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([staleFollow]);
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([makeChannel()]),
      getPublicChannel: vi.fn().mockResolvedValue(
        makeChannel({
          id: "20120336",
          isVerified: true,
        })
      ),
    };

    const repaired = await repairKickFollowSlugs(client, [staleFollow]);
    const stored = persistedValues.get("kick-follow-verification-cache-v1") as {
      entries: Record<string, unknown>;
    };

    expect(repaired.get(staleFollow.id)?.isVerified).toBe(false);
    expect(stored.entries).not.toHaveProperty("21103818");
  });
});
