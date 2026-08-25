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
    getActiveFollowsByPlatform: vi.fn(),
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
import {
  repairKickFollowSlugs,
  resolveKickFollowPlaybackSlug,
} from "@/backend/services/kick-follow-metadata-repair";
import { logger } from "@/backend/logging/logger";
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
// Guards: legacy slug-keyed follows remain repairable for listing, scanning, and playback through the exact ID in their canonical avatar URL.
// Guards: ID-less Kick follows hydrate by slug without replacing richer stored display-name casing with a lowercase slug fallback.
// Guards: stale callers do not repeat persisted repairs, and real repair batches emit one count-only summary instead of per-channel success logs.
// Guards: account follow sync owns account avatars, while guest repair accepts a genuinely new asset without oscillating renditions.
describe("repairKickFollowSlugs verification metadata", () => {
  it("repairs a slug-keyed follow through the broadcaster ID in its avatar URL", async () => {
    const staleFollow = makeFollow({
      id: "row-abby",
      channelId: "abby201",
      channelName: "abby201",
      displayName: "Abby201",
      profileImage: "https://files.kick.com/images/user/110821336/profile_image/conversion.webp",
    });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([staleFollow]);
    const renamedChannel = makeChannel({
      id: "110821336",
      username: "abbyapple",
      displayName: "AbbyApple",
      avatarUrl: "https://files.kick.com/images/user/110821336/profile_image/current.webp",
    });
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([renamedChannel]),
      getPublicChannel: vi.fn().mockResolvedValue({
        ...renamedChannel,
        kickUserId: "110821336",
      }),
    };

    const repaired = await repairKickFollowSlugs(client, [staleFollow]);

    expect(client.getChannelsByBroadcasterIds).toHaveBeenCalledWith([110821336]);
    expect(repaired.get(staleFollow.id)?.username).toBe("abbyapple");
  });

  it("hydrates an ID-less follow by slug without downgrading stored display-name casing", async () => {
    const legacyFollow = makeFollow({
      id: "row-nickwhite",
      channelId: "nickwhite",
      channelName: "nickwhite",
      displayName: "NickWhite",
      profileImage: "",
    });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([legacyFollow]);
    const slugChannel = makeChannel({
      id: "123",
      username: "nickwhite",
      displayName: "nickwhite",
      avatarUrl: "",
    });
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([]),
      getChannelsBySlugs: vi.fn().mockResolvedValue([slugChannel]),
      getPublicChannel: vi.fn().mockResolvedValue(null),
    };

    const repaired = await repairKickFollowSlugs(client, [legacyFollow]);

    expect(client.getChannelsByBroadcasterIds).not.toHaveBeenCalled();
    expect(client.getChannelsBySlugs).toHaveBeenCalledWith(["nickwhite"]);
    expect(repaired.get(legacyFollow.id)).toMatchObject({
      id: "123",
      username: "nickwhite",
      displayName: "NickWhite",
    });
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("row-nickwhite", {
      channelId: "123",
    });
  });

  it("does not rewrite metadata when a stale caller is behind the stored follow", async () => {
    const staleRequest = makeFollow();
    const storedCurrent = makeFollow({
      channelName: "hennytingzz",
      displayName: "Hennytingzz",
      profileImage: "https://example.com/current-henny.webp",
    });
    const currentChannel = makeChannel({
      username: "hennytingzz",
      displayName: "Hennytingzz",
      avatarUrl: "https://example.com/current-henny.webp",
    });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([storedCurrent]);
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([currentChannel]),
      getPublicChannel: vi.fn().mockResolvedValue({
        ...currentChannel,
        kickUserId: currentChannel.id,
      }),
    };

    await repairKickFollowSlugs(client, [staleRequest]);

    expect(storageService.updateLocalFollow).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("summarizes a repair batch without logging one success per follow", async () => {
    const follows = [
      makeFollow({ id: "row-one", channelId: "101", channelName: "old-one" }),
      makeFollow({ id: "row-two", channelId: "202", channelName: "old-two" }),
    ];
    const channels = [
      makeChannel({ id: "101", username: "new-one", displayName: "New One" }),
      makeChannel({ id: "202", username: "new-two", displayName: "New Two" }),
    ];
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue(follows);
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue(channels),
      getPublicChannel: vi.fn().mockImplementation(async (slug: string) => {
        const channel = channels.find((candidate) => candidate.username === slug);
        return channel ? { ...channel, kickUserId: channel.id } : null;
      }),
    };

    await repairKickFollowSlugs(client, follows);

    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      "IPC:KickFollowRepair",
      "Kick follow metadata repair completed",
      {
        requestedCount: 2,
        resolvedCount: 2,
        updatedCount: 2,
        updatedFieldCounts: {
          channelId: 0,
          channelName: 2,
          displayName: 2,
          profileImage: 0,
        },
      }
    );
  });

  it("treats medium and fullsize renditions of the same Kick avatar as equivalent", async () => {
    const assetId = "3a5f6300-2462-407f-ac56-d351783055b5";
    const storedFollow = makeFollow({
      channelName: "hennytingzz",
      displayName: "Hennytingzz",
      profileImage: `https://files.kick.com/images/user/21103818/profile_image/conversion/${assetId}-medium.webp`,
    });
    const currentChannel = makeChannel({
      avatarUrl: `https://files.kick.com/images/user/21103818/profile_image/conversion/${assetId}-fullsize.webp`,
    });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([storedFollow]);
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([currentChannel]),
      getPublicChannel: vi.fn().mockResolvedValue({
        ...currentChannel,
        kickUserId: currentChannel.id,
      }),
    };

    await repairKickFollowSlugs(client, [storedFollow]);

    expect(storageService.updateLocalFollow).not.toHaveBeenCalled();
  });

  it("persists a genuinely new Kick avatar asset", async () => {
    const storedFollow = makeFollow({
      source: "guest",
      channelName: "hennytingzz",
      displayName: "Hennytingzz",
      profileImage:
        "https://files.kick.com/images/user/21103818/profile_image/conversion/3a5f6300-2462-407f-ac56-d351783055b5-medium.webp",
    });
    const currentAvatar =
      "https://files.kick.com/images/user/21103818/profile_image/conversion/9db9ed3e-2fb6-4948-9085-4bf467367e3d-fullsize.webp";
    const currentChannel = makeChannel({ avatarUrl: currentAvatar });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([storedFollow]);
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([currentChannel]),
      getPublicChannel: vi.fn().mockResolvedValue({
        ...currentChannel,
        kickUserId: currentChannel.id,
      }),
    };

    await repairKickFollowSlugs(client, [storedFollow]);

    expect(storageService.updateLocalFollow).toHaveBeenCalledWith(storedFollow.id, {
      profileImage: currentAvatar,
    });
  });

  it("resolves playback for a renamed slug-keyed follow through its avatar identity", async () => {
    const staleFollow = makeFollow({
      id: "row-abby",
      channelId: "abby201",
      channelName: "abby201",
      profileImage: "https://files.kick.com/images/user/110821336/profile_image/conversion.webp",
    });
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([staleFollow]);
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([staleFollow]);
    const renamedChannel = makeChannel({
      id: "110821336",
      username: "abbyapple",
      displayName: "AbbyApple",
    });
    const client = {
      getChannelsByBroadcasterIds: vi.fn().mockResolvedValue([renamedChannel]),
      getPublicChannel: vi.fn().mockResolvedValue({
        ...renamedChannel,
        kickUserId: "110821336",
      }),
    };

    const slug = await resolveKickFollowPlaybackSlug(client, "abby201");

    expect(slug).toBe("abbyapple");
  });

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
