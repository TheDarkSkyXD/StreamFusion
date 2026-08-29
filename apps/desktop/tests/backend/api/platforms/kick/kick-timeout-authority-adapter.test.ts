import { describe, expect, it, vi } from "vitest";
import {
  authorizeKickProductionChannel,
  createKickTimeoutAuthorityAdapter,
  queryKickProductionTargetState,
} from "@backend/api/platforms/kick/kick-timeout-authority-adapter";

const binding = {
  platform: "kick" as const,
  channelId: "100",
  channelSlug: "streamer",
  targetUserId: "300",
  targetUsername: "viewer",
  action: "timeout" as const,
};

function channelUserState(overrides: Record<string, unknown> = {}) {
  return {
    userId: "300",
    login: "viewer",
    displayName: "Viewer",
    isModerator: false,
    isChannelOwner: false,
    isStaff: false,
    banned: null,
    ...overrides,
  };
}

describe("Kick timeout authority adapter", () => {
  it("authorizes the exact authenticated Kick moderator from channel-user state", async () => {
    const readChannelUserState = vi.fn().mockResolvedValue({
      userId: "200",
      login: "realmod",
      displayName: "RealMod",
      isModerator: true,
      isChannelOwner: false,
      isStaff: false,
      banned: null,
    });

    await expect(
      authorizeKickProductionChannel(
        binding,
        {
          actorId: "200",
          actorUsername: "realmod",
          accessToken: "token",
          scopes: ["moderation:ban"],
        },
        readChannelUserState
      )
    ).resolves.toEqual({ state: "authorized", role: "moderator" });
    expect(readChannelUserState).toHaveBeenCalledWith("streamer", "realmod");
  });

  it("treats an exact unbanned ordinary Kick target as clear", async () => {
    const readChannelUserState = vi.fn().mockResolvedValue({
      userId: "300",
      login: "viewer",
      displayName: "Viewer",
      isModerator: false,
      isChannelOwner: false,
      isStaff: false,
      banned: null,
    });

    await expect(
      queryKickProductionTargetState(
        binding,
        {
          actorId: "200",
          actorUsername: "realmod",
          accessToken: "token",
          scopes: ["moderation:ban"],
        },
        readChannelUserState
      )
    ).resolves.toEqual({ state: "clear", targetIsModerator: false });
    expect(readChannelUserState).toHaveBeenCalledWith("streamer", "viewer");
  });

  it("authorizes an exact owner as broadcaster and rejects an exact ordinary actor", async () => {
    const credential = {
      actorId: "200",
      actorUsername: "realmod",
      accessToken: "token",
      scopes: ["moderation:ban"],
    };

    await expect(
      authorizeKickProductionChannel(
        binding,
        credential,
        vi
          .fn()
          .mockResolvedValue(
            channelUserState({ userId: "200", login: "realmod", isChannelOwner: true })
          )
      )
    ).resolves.toEqual({ state: "authorized", role: "broadcaster" });
    await expect(
      authorizeKickProductionChannel(
        binding,
        credential,
        vi.fn().mockResolvedValue(channelUserState({ userId: "200", login: "realmod" }))
      )
    ).resolves.toEqual({ state: "unauthorized" });
  });

  it("keeps actor identity mismatches, missing logins, and reader failures unverifiable", async () => {
    const credential = {
      actorId: "200",
      actorUsername: "realmod",
      accessToken: "token",
      scopes: ["moderation:ban"],
    };

    await expect(
      authorizeKickProductionChannel(
        binding,
        credential,
        vi.fn().mockResolvedValue(channelUserState({ userId: "different", login: "realmod" }))
      )
    ).resolves.toEqual({ state: "unverifiable" });
    await expect(
      authorizeKickProductionChannel(binding, credential, vi.fn().mockRejectedValue(new Error("x")))
    ).resolves.toEqual({ state: "unverifiable" });
    await expect(
      authorizeKickProductionChannel(binding, { ...credential, actorUsername: undefined }, vi.fn())
    ).resolves.toEqual({ state: "unverifiable" });
  });

  it("treats banned, staff, and owner targets as invalid while carrying moderator state", async () => {
    const credential = {
      actorId: "200",
      actorUsername: "realmod",
      accessToken: "token",
      scopes: ["moderation:ban"],
    };

    for (const target of [
      channelUserState({ banned: { permanent: false } }),
      channelUserState({ isStaff: true }),
      channelUserState({ isChannelOwner: true }),
    ]) {
      await expect(
        queryKickProductionTargetState(binding, credential, vi.fn().mockResolvedValue(target))
      ).resolves.toEqual({ state: "invalid" });
    }
    await expect(
      queryKickProductionTargetState(
        binding,
        credential,
        vi.fn().mockResolvedValue(channelUserState({ isModerator: true }))
      )
    ).resolves.toEqual({ state: "clear", targetIsModerator: true });
  });

  it("keeps target identity mismatches and reader failures unverifiable", async () => {
    const credential = {
      actorId: "200",
      actorUsername: "realmod",
      accessToken: "token",
      scopes: ["moderation:ban"],
    };

    await expect(
      queryKickProductionTargetState(
        binding,
        credential,
        vi.fn().mockResolvedValue(channelUserState({ login: "someone-else" }))
      )
    ).resolves.toEqual({ state: "unverifiable" });
    await expect(
      queryKickProductionTargetState(
        binding,
        credential,
        vi.fn().mockRejectedValue(new Error("Kick unavailable"))
      )
    ).resolves.toEqual({ state: "unverifiable" });
  });

  it("uses whole minutes, numeric stable ids, and the authenticated Kick actor", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createKickTimeoutAuthorityAdapter({
      getCredential: vi.fn().mockResolvedValue({
        actorId: "200",
        accessToken: "main-only-token",
        scopes: ["moderation:ban", "channel:read"],
      }),
      authorizeChannel: vi.fn().mockResolvedValue({ state: "authorized", role: "moderator" }),
      queryTargetState: vi.fn().mockResolvedValue({ state: "clear", targetIsModerator: false }),
      execute,
    });

    await expect(adapter.inspectTimeoutTarget(binding)).resolves.toMatchObject({
      state: "verified",
      actor: { id: "200", role: "moderator" },
      policy: {
        durationUnit: "minutes",
        minDuration: 1,
        maxDuration: 10_080,
        maxReasonLength: 100,
      },
    });
    await expect(
      adapter.executeTimeout({
        binding,
        actor: { id: "200", role: "moderator" },
        duration: 10,
        reason: "Spam",
      })
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({
      accessToken: "main-only-token",
      broadcasterUserId: 100,
      userId: 300,
      duration: 10,
      reason: "Spam",
    });
  });
});
