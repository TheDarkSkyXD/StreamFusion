import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { useFollowStore } from "@/store/follow-store";

type MockFollow = {
  id: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelName: string;
  displayName: string;
  profileImage: string;
  followedAt: string;
  source: "guest" | "account";
};

function makeChannel(overrides: Partial<UnifiedChannel> = {}): UnifiedChannel {
  return {
    id: "411439",
    platform: "kick",
    username: "chickenandy",
    displayName: "ChickenAndy",
    avatarUrl: "",
    isLive: false,
    isVerified: false,
    isPartner: false,
    ...overrides,
  };
}

function makeRow(overrides: Partial<MockFollow> = {}): MockFollow {
  return {
    id: "kick-guest-421500-1700000000000",
    platform: "kick",
    channelId: "421500",
    channelName: "chickenandy",
    displayName: "ChickenAndy",
    profileImage: "",
    followedAt: "2026-05-15T00:00:00.000Z",
    source: "guest",
    ...overrides,
  };
}

const mockApi = {
  getAll: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  mockApi.getAll.mockReset();
  mockApi.add.mockReset();
  mockApi.remove.mockReset();
  // @ts-expect-error — test-only stub of window.electronAPI surface
  globalThis.window.electronAPI = { follows: mockApi };
  useFollowStore.setState({ localFollows: [] });
});

afterEach(() => {
  // @ts-expect-error — clean up the test stub
  delete globalThis.window.electronAPI;
});

describe("follow-store isFollowing", () => {
  it("returns true for canonical channel when only a legacy user_id row is in memory", () => {
    // Simulates the chickenandy case: DB row carries user_id (421500), but
    // useChannelByUsername returns the canonical channel.id (411439).
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "421500" })],
    });

    expect(
      useFollowStore.getState().isFollowing(makeChannel({ id: "411439" }))
    ).toBe(true);
  });

  it("returns false for a different channel on the same platform", () => {
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "421500", username: "chickenandy" })],
    });

    expect(
      useFollowStore
        .getState()
        .isFollowing(makeChannel({ id: "676", username: "xqc" }))
    ).toBe(false);
  });

  it("does not bridge across platforms even when usernames match", () => {
    useFollowStore.setState({
      localFollows: [makeChannel({ platform: "kick", username: "xqc" })],
    });

    expect(
      useFollowStore
        .getState()
        .isFollowing(makeChannel({ platform: "twitch", username: "xqc" }))
    ).toBe(false);
  });
});

describe("follow-store followChannel", () => {
  it("dedupes by slug when an in-memory row carries a different (stale) id", async () => {
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "421500" })],
    });

    await useFollowStore.getState().followChannel(makeChannel({ id: "411439" }));

    expect(useFollowStore.getState().localFollows).toHaveLength(1);
    expect(mockApi.add).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic add when the backend rejects", async () => {
    mockApi.add.mockRejectedValueOnce(new Error("backend down"));

    await useFollowStore.getState().followChannel(makeChannel());

    expect(useFollowStore.getState().localFollows).toEqual([]);
  });
});

describe("follow-store unfollowChannel", () => {
  it("slug-bridges to the backend row when ids diverge (legacy user_id case)", async () => {
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "421500" })],
    });
    mockApi.getAll.mockResolvedValueOnce([
      makeRow({ id: "kick-guest-421500-x", channelId: "421500" }),
    ]);

    await useFollowStore
      .getState()
      .unfollowChannel(makeChannel({ id: "411439" }));

    expect(mockApi.remove).toHaveBeenCalledTimes(1);
    expect(mockApi.remove).toHaveBeenCalledWith("kick-guest-421500-x");
    expect(useFollowStore.getState().localFollows).toEqual([]);
  });

  it("removes every matching backend row, not just the first (dual-row case)", async () => {
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "421500" })],
    });
    mockApi.getAll.mockResolvedValueOnce([
      makeRow({ id: "row-legacy", channelId: "421500" }),
      makeRow({ id: "row-fresh", channelId: "411439" }),
    ]);

    await useFollowStore
      .getState()
      .unfollowChannel(makeChannel({ id: "411439" }));

    expect(mockApi.remove).toHaveBeenCalledTimes(2);
    expect(mockApi.remove).toHaveBeenCalledWith("row-legacy");
    expect(mockApi.remove).toHaveBeenCalledWith("row-fresh");
  });

  it("no-ops and does not query the backend when the channel is not in localFollows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await useFollowStore.getState().unfollowChannel(makeChannel());

    expect(mockApi.getAll).not.toHaveBeenCalled();
    expect(mockApi.remove).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
