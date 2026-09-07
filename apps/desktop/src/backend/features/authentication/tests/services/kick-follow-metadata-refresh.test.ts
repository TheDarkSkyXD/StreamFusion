import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalFollow } from "@shared/auth-types";

const stopInterval = vi.fn();

vi.mock("@backend/features/authentication/data/authentication-repository", () => ({
  authenticationRepository: {
    getLocalFollowsByPlatform: vi.fn(),
  },
}));

vi.mock("@backend/features/discovery/adapters/kick/channel-endpoints", () => ({
  getChannelsByBroadcasterIds: vi.fn(),
  getChannelsBySlugs: vi.fn(),
  getPublicChannel: vi.fn(),
}));
vi.mock("@backend/api/platforms/kick/kick-transport", () => ({
  kickTransport: { request: vi.fn() },
}));

vi.mock("@backend/features/authentication/adapters/kick/kick-follow-identity-service", () => ({
  resolveKickFollowMetadata: vi.fn(),
}));

vi.mock("@shared/utils/managed-interval", () => ({
  createManagedInterval: vi.fn(() => ({ stop: stopInterval })),
}));

describe("kick follow metadata refresh", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
  });

  afterEach(async () => {
    const { stopKickFollowMetadataRefresh } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-metadata-refresh");
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
    const { authenticationRepository } =
      await import("@backend/features/authentication/data/authentication-repository");
    const { resolveKickFollowMetadata } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-identity-service");
    const { refreshKickFollowMetadataNow } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-metadata-refresh");

    vi.mocked(authenticationRepository.getLocalFollowsByPlatform).mockReturnValue(follows);
    vi.mocked(resolveKickFollowMetadata).mockResolvedValue(new Map());

    await refreshKickFollowMetadataNow("test", { force: true });

    expect(authenticationRepository.getLocalFollowsByPlatform).toHaveBeenCalledWith("kick");
    expect(resolveKickFollowMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        getChannelsByBroadcasterIds: expect.any(Function),
        getChannelsBySlugs: expect.any(Function),
        getPublicChannel: expect.any(Function),
      }),
      follows
    );
  });

  it("throttles repeated manual refreshes", async () => {
    vi.useFakeTimers();
    const { authenticationRepository } =
      await import("@backend/features/authentication/data/authentication-repository");
    const { resolveKickFollowMetadata } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-identity-service");
    const { refreshKickFollowMetadataNow } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-metadata-refresh");

    vi.mocked(authenticationRepository.getLocalFollowsByPlatform).mockReturnValue([
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
    vi.mocked(resolveKickFollowMetadata).mockResolvedValue(new Map());

    await refreshKickFollowMetadataNow("first", { force: true });
    await refreshKickFollowMetadataNow("second");

    expect(resolveKickFollowMetadata).toHaveBeenCalledTimes(1);
  });

  it("defers nonessential metadata work while account reconciliation is active", async () => {
    const { resolveKickFollowMetadata } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-identity-service");
    const { beginKickAccountReconciliation } =
      await import("@backend/features/authentication/domain/kick-account-reconciliation-coordinator");
    const { refreshKickFollowMetadataNow } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-metadata-refresh");
    const release = beginKickAccountReconciliation();
    try {
      await refreshKickFollowMetadataNow("startup", { force: true });
    } finally {
      release();
    }

    expect(resolveKickFollowMetadata).not.toHaveBeenCalled();
  });

  it("defers the nonessential full follow sweep until the interval and stops it cleanly", async () => {
    vi.useFakeTimers();
    const { authenticationRepository } =
      await import("@backend/features/authentication/data/authentication-repository");
    const { resolveKickFollowMetadata } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-identity-service");
    const { createManagedInterval } = await import("@shared/utils/managed-interval");
    const { startKickFollowMetadataRefresh, stopKickFollowMetadataRefresh } =
      await import("@backend/features/authentication/adapters/kick/kick-follow-metadata-refresh");

    vi.mocked(authenticationRepository.getLocalFollowsByPlatform).mockReturnValue([]);
    vi.mocked(resolveKickFollowMetadata).mockResolvedValue(new Map());

    startKickFollowMetadataRefresh();

    expect(authenticationRepository.getLocalFollowsByPlatform).not.toHaveBeenCalled();
    expect(createManagedInterval).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1000, {
      unref: true,
    });

    stopKickFollowMetadataRefresh();

    expect(stopInterval).toHaveBeenCalledTimes(1);
  });
});
