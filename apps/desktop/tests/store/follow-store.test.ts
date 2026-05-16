import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import type { LocalFollow } from "@/shared/auth-types";
import { useFollowStore } from "@/store/follow-store";

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

function makeRow(overrides: Partial<LocalFollow> = {}): LocalFollow {
  return {
    id: "kick-guest-421500-1700000000000",
    platform: "kick",
    channelId: "421500",
    channelName: "chickenandy",
    displayName: "ChickenAndy",
    profileImage: "",
    followedAt: "2026-05-15T00:00:00.000Z",
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

  it("returns true for synthesized {id:''} channel when a canonical-id row exists for the same slug", () => {
    // Synthesized-fallback case: the VOD page renders FollowButton with a
    // channel whose id is "" before useChannelByUsername resolves. The button
    // must still reflect the followed state via slug bridge.
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "411439", username: "chickenandy" })],
    });

    expect(
      useFollowStore
        .getState()
        .isFollowing(makeChannel({ id: "", username: "chickenandy" }))
    ).toBe(true);
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

  it("writes the mapped payload to electronAPI.follows.add on a fresh follow", async () => {
    const channel = makeChannel({
      id: "411439",
      username: "chickenandy",
      displayName: "ChickenAndy",
      avatarUrl: "https://example/avatar.webp",
    });

    await useFollowStore.getState().followChannel(channel);

    expect(mockApi.add).toHaveBeenCalledTimes(1);
    expect(mockApi.add).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      channelName: "chickenandy",
      displayName: "ChickenAndy",
      profileImage: "https://example/avatar.webp",
    });
    expect(useFollowStore.getState().localFollows).toEqual([channel]);
  });

  it("rolls back the optimistic add when the backend rejects (seeds a pre-existing row so rollback is observable)", async () => {
    const existing = makeChannel({ id: "676", username: "xqc", displayName: "xQc" });
    useFollowStore.setState({ localFollows: [existing] });
    mockApi.add.mockRejectedValueOnce(new Error("backend down"));

    await useFollowStore.getState().followChannel(makeChannel());

    // Optimistic update must have happened (otherwise this test passes against a
    // no-op implementation), and rollback must restore exactly the seeded state.
    expect(mockApi.add).toHaveBeenCalledTimes(1);
    expect(useFollowStore.getState().localFollows).toEqual([existing]);
  });

  it("dedupes a synthesized {id:''} follow against an existing canonical-id row", async () => {
    // Click-before-resolve case: a canonical-id row already exists (from a
    // prior session's hydrate); the user clicks Follow with the synthesized
    // {id: ""} channel. The slug-bridge in channelsMatch must catch this so
    // we don't write a duplicate row with an empty channelId.
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "411439", username: "chickenandy" })],
    });

    await useFollowStore
      .getState()
      .followChannel(makeChannel({ id: "", username: "chickenandy" }));

    expect(useFollowStore.getState().localFollows).toHaveLength(1);
    expect(mockApi.add).not.toHaveBeenCalled();
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
    // Pin iteration order — the unfollow loop iterates backendFollows.filter
    // which preserves the order returned by getAll. A refactor to Promise.all
    // (parallel) or reverse iteration would change this and may matter if the
    // backend is order-sensitive.
    expect(mockApi.remove.mock.calls[0][0]).toBe("row-legacy");
    expect(mockApi.remove.mock.calls[1][0]).toBe("row-fresh");
  });

  it("no-ops and does not query the backend when the channel is not in localFollows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await useFollowStore.getState().unfollowChannel(makeChannel());

    expect(mockApi.getAll).not.toHaveBeenCalled();
    expect(mockApi.remove).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("follow-store upgradeFollowIfNeeded", () => {
  it("replaces a stale empty-id row with the canonical channel and migrates the backend row", async () => {
    // Synthesized-fallback scenario: an earlier click-before-resolve wrote a
    // row with channelId: "". When the canonical channel resolves, the store
    // upgrades the in-memory row, deletes the empty-id DB row, and writes the
    // canonical row.
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "", username: "chickenandy" })],
    });
    mockApi.getAll.mockResolvedValueOnce([
      makeRow({ id: "empty-id-row", channelId: "", channelName: "chickenandy" }),
    ]);

    const canonical = makeChannel({ id: "411439", username: "chickenandy" });
    await useFollowStore.getState().upgradeFollowIfNeeded(canonical);

    // In-memory row replaced with canonical
    expect(useFollowStore.getState().localFollows).toEqual([canonical]);
    // Backend remove called for the empty-id row
    expect(mockApi.remove).toHaveBeenCalledTimes(1);
    expect(mockApi.remove).toHaveBeenCalledWith("empty-id-row");
    // Backend add called with the canonical payload
    expect(mockApi.add).toHaveBeenCalledTimes(1);
    expect(mockApi.add).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      channelName: "chickenandy",
      displayName: canonical.displayName,
      profileImage: canonical.avatarUrl,
    });
  });

  it("is a no-op when no stale empty-id row exists", async () => {
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "411439", username: "chickenandy" })],
    });

    await useFollowStore
      .getState()
      .upgradeFollowIfNeeded(makeChannel({ id: "411439", username: "chickenandy" }));

    expect(mockApi.getAll).not.toHaveBeenCalled();
    expect(mockApi.remove).not.toHaveBeenCalled();
    expect(mockApi.add).not.toHaveBeenCalled();
  });

  it("is a no-op when the incoming channel has no canonical id", async () => {
    useFollowStore.setState({
      localFollows: [makeChannel({ id: "", username: "chickenandy" })],
    });

    await useFollowStore
      .getState()
      .upgradeFollowIfNeeded(makeChannel({ id: "", username: "chickenandy" }));

    expect(mockApi.getAll).not.toHaveBeenCalled();
    expect(mockApi.add).not.toHaveBeenCalled();
  });
});
