import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalFollow } from "../../../src/shared/auth-types";

const stopInterval = vi.fn();

vi.mock("../../../src/backend/services/storage-service", () => ({
  storageService: {
    getLocalFollowsByPlatform: vi.fn(),
  },
}));

vi.mock("../../../src/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getChannelsByBroadcasterIds: vi.fn(),
  },
}));

vi.mock("../../../src/backend/services/kick-follow-metadata-repair", () => ({
  repairKickFollowSlugs: vi.fn(),
}));

vi.mock("../../../src/lib/managed-interval", () => ({
  createManagedInterval: vi.fn(() => ({ stop: stopInterval })),
}));

describe("kick follow metadata refresh", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
  });

  afterEach(async () => {
    const { stopKickFollowMetadataRefresh } = await import(
      "../../../src/backend/services/kick-follow-metadata-refresh"
    );
    stopKickFollowMetadataRefresh();
    vi.useRealTimers();
  });

  it("refreshes every stored Kick follow through the shared broadcaster-id repair path", async () => {
    vi.useFakeTimers();
    const follows = [
      {
        id: "kick-row-1",
        platform: "kick",
        channelId: "123",
        channelName: "old-slug",
        displayName: "Old Slug",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ] as LocalFollow[];
    const { storageService } = await import("../../../src/backend/services/storage-service");
    const { kickClient } = await import("../../../src/backend/api/platforms/kick/kick-client");
    const { repairKickFollowSlugs } = await import(
      "../../../src/backend/services/kick-follow-metadata-repair"
    );
    const { refreshKickFollowMetadataNow } = await import(
      "../../../src/backend/services/kick-follow-metadata-refresh"
    );

    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue(follows);
    vi.mocked(repairKickFollowSlugs).mockResolvedValue(new Map());

    await refreshKickFollowMetadataNow("test", { force: true });

    expect(storageService.getLocalFollowsByPlatform).toHaveBeenCalledWith("kick");
    expect(repairKickFollowSlugs).toHaveBeenCalledWith(kickClient, follows);
  });

  it("throttles repeated manual refreshes", async () => {
    vi.useFakeTimers();
    const { storageService } = await import("../../../src/backend/services/storage-service");
    const { repairKickFollowSlugs } = await import(
      "../../../src/backend/services/kick-follow-metadata-repair"
    );
    const { refreshKickFollowMetadataNow } = await import(
      "../../../src/backend/services/kick-follow-metadata-refresh"
    );

    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([
      {
        id: "kick-row-1",
        platform: "kick",
        channelId: "123",
        channelName: "old-slug",
        displayName: "Old Slug",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ] as LocalFollow[]);
    vi.mocked(repairKickFollowSlugs).mockResolvedValue(new Map());

    await refreshKickFollowMetadataNow("first", { force: true });
    await refreshKickFollowMetadataNow("second");

    expect(repairKickFollowSlugs).toHaveBeenCalledTimes(1);
  });

  it("starts a startup refresh, schedules an interval, and stops the interval", async () => {
    vi.useFakeTimers();
    const { storageService } = await import("../../../src/backend/services/storage-service");
    const { repairKickFollowSlugs } = await import(
      "../../../src/backend/services/kick-follow-metadata-repair"
    );
    const { createManagedInterval } = await import("../../../src/lib/managed-interval");
    const { startKickFollowMetadataRefresh, stopKickFollowMetadataRefresh } = await import(
      "../../../src/backend/services/kick-follow-metadata-refresh"
    );

    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([]);
    vi.mocked(repairKickFollowSlugs).mockResolvedValue(new Map());

    startKickFollowMetadataRefresh();
    await vi.runAllTimersAsync();

    expect(storageService.getLocalFollowsByPlatform).toHaveBeenCalledWith("kick");
    expect(createManagedInterval).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1000, {
      unref: true,
    });

    stopKickFollowMetadataRefresh();

    expect(stopInterval).toHaveBeenCalledTimes(1);
  });
});
