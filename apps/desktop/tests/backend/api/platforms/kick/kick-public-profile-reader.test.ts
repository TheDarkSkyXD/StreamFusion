import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUsersById: vi.fn(),
  getUsersByIdStrict: vi.fn(),
  getPublicChannelUserProfile: vi.fn(),
  getPublicChannelUserProfiles: vi.fn(),
  getChannelsBySlugs: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: mocks,
}));

import {
  getKickAccountCreated,
  getKickAccountFollowState,
  getKickAccountFollowStates,
  getKickFollowRelationship,
  getKickPublicIdentity,
  resetKickPublicProfileReaderCacheForTests,
} from "@/backend/api/platforms/kick/kick-public-profile-reader";

// Guards: documented Kick user data wins before the isolated first-party fallback.
// Guards: only an identity-matched first-party payload with explicit null following_since proves a Kick unfollow.
// Guards: missing, malformed, failed, and identity-mismatched relationships remain unavailable.
describe("Kick public profile reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKickPublicProfileReaderCacheForTests();
  });

  it("classifies a batch only from exact viewer identities and explicit relationships", async () => {
    mocks.getPublicChannelUserProfiles.mockResolvedValue([
      {
        channelSlug: "followed",
        profile: { userId: "123", username: "viewer", followingSince: "2026-01-01T00:00:00Z" },
      },
      {
        channelSlug: "not-followed",
        profile: { userId: "123", username: "viewer", followingSince: null },
      },
      {
        channelSlug: "wrong-viewer",
        profile: { userId: "999", username: "viewer", followingSince: null },
      },
    ]);

    await expect(
      getKickAccountFollowStates("123", "viewer", ["followed", "not-followed", "wrong-viewer"])
    ).resolves.toEqual(
      new Map([
        ["followed", "followed"],
        ["not-followed", "not-followed"],
        ["wrong-viewer", "unavailable"],
      ])
    );
  });

  it("uses the authenticated batch reader for a fresh post-mutation relationship", async () => {
    mocks.getPublicChannelUserProfiles.mockResolvedValue([
      {
        channelSlug: "streamer",
        profile: { userId: "123", username: "viewer", followingSince: null },
      },
    ]);

    await expect(
      getKickAccountFollowState("123", "viewer", "streamer", { fresh: true })
    ).resolves.toBe("not-followed");
    expect(mocks.getPublicChannelUserProfiles).toHaveBeenCalledWith([
      { channelSlug: "streamer", username: "viewer" },
    ]);
    expect(mocks.getPublicChannelUserProfile).not.toHaveBeenCalled();
  });

  it("returns an exact official user identity without invoking the fallback", async () => {
    mocks.getUsersByIdStrict.mockResolvedValue([
      {
        user_id: 123,
        name: "Alice",
        profile_picture: "https://files.kick.com/alice.webp",
      },
    ]);

    await expect(getKickPublicIdentity("123", "alice", "streamer")).resolves.toEqual({
      state: "known",
      source: "official",
      value: {
        userId: "123",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "https://files.kick.com/alice.webp",
      },
    });
    expect(mocks.getUsersByIdStrict).toHaveBeenCalledWith([123]);
    expect(mocks.getPublicChannelUserProfile).not.toHaveBeenCalled();
  });

  it("accepts an exact official user id as a rename upgrade and normalizes a null avatar", async () => {
    mocks.getUsersByIdStrict.mockResolvedValue([
      { user_id: 123, name: "RenamedAlice", profile_picture: null },
    ]);

    await expect(getKickPublicIdentity("123", "alice", "streamer")).resolves.toMatchObject({
      state: "known",
      source: "official",
      value: {
        userId: "123",
        username: "renamedalice",
        displayName: "RenamedAlice",
        avatarUrl: "",
      },
    });
    expect(mocks.getPublicChannelUserProfile).not.toHaveBeenCalled();
  });

  it("returns a schema-validated exact first-party fallback when official data is absent", async () => {
    mocks.getUsersByIdStrict.mockResolvedValue([]);
    mocks.getPublicChannelUserProfile.mockResolvedValue({
      userId: "123",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "https://files.kick.com/alice.webp",
      followingSince: "2024-05-01T12:30:00Z",
    });

    await expect(getKickPublicIdentity("123", "alice", "streamer")).resolves.toEqual({
      state: "known",
      source: "first-party-fallback",
      value: {
        userId: "123",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "https://files.kick.com/alice.webp",
      },
    });
  });

  it("settles failed when both official and isolated fallback transports fail", async () => {
    mocks.getUsersByIdStrict.mockRejectedValue(new Error("official unavailable"));
    mocks.getPublicChannelUserProfile.mockRejectedValue(new Error("fallback unavailable"));

    await expect(getKickPublicIdentity("123", "alice", "streamer")).resolves.toEqual({
      state: "failed",
      message: "Couldn’t verify",
    });
  });

  it("keeps unsupported account and missing follow dates explicitly unavailable", async () => {
    mocks.getPublicChannelUserProfile.mockResolvedValue({
      userId: "123",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "",
    });

    await expect(getKickAccountCreated("123", "alice", "streamer")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
    await expect(getKickFollowRelationship("123", "alice", "streamer")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
  });

  it("confirms not-followed only from an identity-matched explicit null relationship", async () => {
    mocks.getPublicChannelUserProfile.mockResolvedValue({
      userId: "123",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "",
      followingSince: null,
    });

    await expect(getKickAccountFollowState("123", "alice", "streamer")).resolves.toBe(
      "not-followed"
    );
  });

  it.each([
    ["missing relationship", { userId: "123", username: "alice", followingSince: undefined }],
    ["malformed relationship", { userId: "123", username: "alice", followingSince: "1" }],
    ["identity mismatch", { userId: "999", username: "alice", followingSince: null }],
  ])("keeps %s unavailable instead of proving an unfollow", async (_label, fallback) => {
    mocks.getPublicChannelUserProfile.mockResolvedValue({
      displayName: "Alice",
      avatarUrl: "",
      ...fallback,
    });

    await expect(getKickAccountFollowState("123", "alice", "streamer")).resolves.toBe(
      "unavailable"
    );
  });

  it("coalesces identity and follow fallback reads while preserving an exact follow date", async () => {
    mocks.getPublicChannelUserProfile.mockResolvedValue({
      userId: "legacy-id",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "",
      followingSince: "2024-05-01T12:30:00Z",
    });

    const [identity, follow] = await Promise.all([
      getKickPublicIdentity("legacy-id", "alice", "streamer"),
      getKickFollowRelationship("legacy-id", "alice", "streamer"),
    ]);

    expect(identity.state).toBe("known");
    expect(follow).toEqual({
      state: "known",
      source: "first-party-fallback",
      value: "2024-05-01T12:30:00Z",
    });
    expect(mocks.getPublicChannelUserProfile).toHaveBeenCalledTimes(1);
  });

  it("treats mismatched identity and ambiguous follow timestamps as unavailable", async () => {
    mocks.getUsersByIdStrict.mockResolvedValue([]);
    mocks.getPublicChannelUserProfile.mockResolvedValue({
      userId: "different-user",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "",
      followingSince: "1",
    });

    await expect(getKickPublicIdentity("123", "alice", "streamer")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
    await expect(getKickFollowRelationship("123", "alice", "streamer")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
  });
});
