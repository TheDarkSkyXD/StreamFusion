import { describe, expect, it, vi } from "vitest";
import {
  createTwitchTimeoutAuthorityAdapter,
  parseTwitchTimeoutTargetState,
  queryTwitchProductionTargetState,
} from "@backend/api/platforms/twitch/twitch-timeout-authority-adapter";

const binding = {
  platform: "twitch" as const,
  channelId: "100",
  channelSlug: "streamer",
  targetUserId: "300",
  targetUsername: "viewer",
  selectedMessageId: "message-4",
  action: "timeout" as const,
};

describe("Twitch timeout authority adapter", () => {
  // Guards: the broadcaster's official exact-user Helix read may positively prove a clear target.
  it("treats an authoritative empty broadcaster-self exact-user result as clear", async () => {
    const queryBannedUsers = vi.fn().mockResolvedValue({ data: [], cursor: null });
    const queryModerators = vi.fn().mockResolvedValue({
      ok: true,
      payload: { data: [], pagination: {} },
    });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        {
          actorId: "100",
          actorUsername: "streamer",
          accessToken: "token",
          clientId: "client",
          scopes: ["moderator:manage:banned_users", "channel:manage:moderators"],
        },
        queryBannedUsers,
        queryModerators
      )
    ).resolves.toEqual({ state: "clear", targetIsModerator: false });
    expect(queryBannedUsers).toHaveBeenCalledWith({
      accessToken: "token",
      broadcasterId: "100",
      moderatorUserId: "100",
      clientId: "client",
      userId: "300",
      first: 1,
    });
    expect(queryModerators).toHaveBeenCalledWith({
      accessToken: "token",
      broadcasterId: "100",
      clientId: "client",
      userId: "300",
    });
  });

  // Guards: a broadcaster cannot timeout a target that the exact official roster identifies as a moderator.
  it("treats an exact current moderator as invalid", async () => {
    const queryBannedUsers = vi.fn().mockResolvedValue({ data: [], cursor: null });
    const queryModerators = vi.fn().mockResolvedValue({
      ok: true,
      payload: {
        data: [{ user_id: "300", user_login: "viewer", user_name: "Viewer" }],
        pagination: {},
      },
    });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        {
          actorId: "100",
          accessToken: "token",
          clientId: "client",
          scopes: ["moderator:manage:banned_users", "channel:manage:moderators"],
        },
        queryBannedUsers,
        queryModerators
      )
    ).resolves.toEqual({ state: "invalid" });
  });

  // Guards: an exact Helix ban or active timeout keeps Timeout unavailable.
  it("treats an exact currently banned target as invalid", async () => {
    const queryBannedUsers = vi.fn().mockResolvedValue({
      data: [
        {
          user_id: "300",
          user_login: "viewer",
          user_name: "Viewer",
          expires_at: "",
          created_at: "2026-07-30T12:00:00Z",
          reason: "spam",
          moderator_id: "100",
          moderator_login: "streamer",
          moderator_name: "Streamer",
        },
      ],
      cursor: null,
    });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        {
          actorId: "100",
          accessToken: "token",
          clientId: "client",
          scopes: ["moderator:manage:banned_users", "channel:manage:moderators"],
        },
        queryBannedUsers,
        vi.fn().mockResolvedValue({
          ok: true,
          payload: { data: [], pagination: {} },
        })
      )
    ).resolves.toEqual({ state: "invalid" });
  });

  it("treats an exact currently timed-out target as invalid", async () => {
    const queryBannedUsers = vi.fn().mockResolvedValue({
      data: [
        {
          user_id: "300",
          user_login: "viewer",
          user_name: "Viewer",
          expires_at: "2026-07-30T12:10:00Z",
          created_at: "2026-07-30T12:00:00Z",
          reason: "spam",
          moderator_id: "100",
          moderator_login: "streamer",
          moderator_name: "Streamer",
        },
      ],
      cursor: null,
    });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        {
          actorId: "100",
          accessToken: "token",
          clientId: "client",
          scopes: ["moderator:manage:banned_users", "channel:manage:moderators"],
        },
        queryBannedUsers,
        vi.fn().mockResolvedValue({
          ok: true,
          payload: { data: [], pagination: {} },
        })
      )
    ).resolves.toEqual({ state: "invalid" });
  });

  // Guards: malformed, failed, or identity-mismatched Helix reads must fail closed.
  it("keeps malformed, failed, and mismatched exact-user reads unverifiable", async () => {
    const credential = {
      actorId: "100",
      accessToken: "token",
      clientId: "client",
      scopes: ["moderator:manage:banned_users", "channel:manage:moderators"],
    };

    await expect(
      queryTwitchProductionTargetState(
        binding,
        credential,
        vi.fn().mockResolvedValue({ data: [{ user_id: "300" }], cursor: null }),
        vi.fn().mockResolvedValue({
          ok: true,
          payload: { data: [], pagination: {} },
        })
      )
    ).resolves.toEqual({ state: "unverifiable" });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        credential,
        vi.fn().mockRejectedValue(new Error("Twitch unavailable")),
        vi.fn().mockResolvedValue({
          ok: true,
          payload: { data: [], pagination: {} },
        })
      )
    ).resolves.toEqual({ state: "unverifiable" });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        credential,
        vi.fn().mockResolvedValue({
          data: [
            {
              user_id: "different",
              user_login: "someone-else",
              user_name: "SomeoneElse",
              expires_at: "",
              created_at: "2026-07-30T12:00:00Z",
              reason: "spam",
              moderator_id: "100",
              moderator_login: "streamer",
              moderator_name: "Streamer",
            },
          ],
          cursor: null,
        }),
        vi.fn().mockResolvedValue({
          ok: true,
          payload: { data: [], pagination: {} },
        })
      )
    ).resolves.toEqual({ state: "unverifiable" });
  });

  // Guards: incomplete, failed, or identity-mismatched moderator rosters must fail closed.
  it("keeps malformed, failed, and mismatched moderator reads unverifiable", async () => {
    const credential = {
      actorId: "100",
      accessToken: "token",
      clientId: "client",
      scopes: ["moderator:manage:banned_users", "channel:manage:moderators"],
    };
    const queryBannedUsers = vi.fn().mockResolvedValue({ data: [], cursor: null });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        credential,
        queryBannedUsers,
        vi.fn().mockResolvedValue({
          ok: true,
          payload: { data: [{ user_id: "300" }], pagination: {} },
        })
      )
    ).resolves.toEqual({ state: "unverifiable" });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        credential,
        queryBannedUsers,
        vi.fn().mockResolvedValue({
          ok: false,
          kind: "network",
          message: "Twitch unavailable",
        })
      )
    ).resolves.toEqual({ state: "unverifiable" });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        credential,
        queryBannedUsers,
        vi.fn().mockResolvedValue({
          ok: true,
          payload: {
            data: [
              {
                user_id: "different",
                user_login: "someone-else",
                user_name: "SomeoneElse",
              },
            ],
            pagination: {},
          },
        })
      )
    ).resolves.toEqual({ state: "unverifiable" });
  });

  // Guards: broadcaster-self verification requires an official Get Moderators read scope.
  it("fails closed before querying when the broadcaster lacks moderator-roster scope", async () => {
    const queryBannedUsers = vi.fn();
    const queryModerators = vi.fn();

    await expect(
      queryTwitchProductionTargetState(
        binding,
        {
          actorId: "100",
          accessToken: "token",
          clientId: "client",
          scopes: ["moderator:manage:banned_users"],
        },
        queryBannedUsers,
        queryModerators
      )
    ).resolves.toEqual({ state: "unverifiable" });
    expect(queryBannedUsers).not.toHaveBeenCalled();
    expect(queryModerators).not.toHaveBeenCalled();
  });

  // Guards: ordinary moderators remain fail-closed until Twitch provides a captured authoritative target-state contract.
  it("does not use broadcaster-only Helix authority for an ordinary moderator", async () => {
    const queryBannedUsers = vi.fn().mockResolvedValue({ data: [], cursor: null });
    const queryModerators = vi.fn().mockResolvedValue({
      ok: true,
      payload: { data: [], pagination: {} },
    });

    await expect(
      queryTwitchProductionTargetState(
        binding,
        {
          actorId: "200",
          accessToken: "token",
          clientId: "client",
          scopes: [
            "moderator:manage:banned_users",
            "user:read:moderated_channels",
            "channel:manage:moderators",
          ],
        },
        queryBannedUsers,
        queryModerators
      )
    ).resolves.toEqual({ state: "unverifiable" });
    expect(queryBannedUsers).not.toHaveBeenCalled();
    expect(queryModerators).not.toHaveBeenCalled();
  });

  // Guards: undocumented Twitch GQL null state cannot positively authorize Timeout.
  it("fails closed when the raw GQL ban status is null without captured null semantics", () => {
    expect(
      parseTwitchTimeoutTargetState(
        {
          data: {
            currentUser: { id: "200", login: "realmod" },
            channelUser: { id: "100", login: "streamer" },
            targetUser: { id: "300", login: "viewer", isModerator: false },
            banStatus: null,
          },
        },
        binding,
        "200"
      )
    ).toEqual({ state: "unverifiable" });

    expect(
      parseTwitchTimeoutTargetState(
        {
          data: {
            currentUser: { id: "different", login: "other" },
            channelUser: { id: "100", login: "streamer" },
            targetUser: { id: "300", login: "viewer", isModerator: false },
            banStatus: null,
          },
        },
        binding,
        "200"
      )
    ).toEqual({ state: "unverifiable" });
  });

  it("uses the authenticated moderator id and fails closed for protected or timed-out targets", async () => {
    const queryTargetState = vi
      .fn()
      .mockResolvedValueOnce({ state: "clear", targetIsModerator: false })
      .mockResolvedValueOnce({ state: "clear", targetIsModerator: false });
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createTwitchTimeoutAuthorityAdapter({
      getCredential: vi.fn().mockResolvedValue({
        actorId: "200",
        accessToken: "main-only-token",
        clientId: "client",
        scopes: ["moderator:manage:banned_users", "user:read:moderated_channels"],
      }),
      authorizeChannel: vi.fn().mockResolvedValue({ state: "authorized", role: "moderator" }),
      queryTargetState,
      execute,
    });

    await expect(adapter.inspectTimeoutTarget(binding)).resolves.toMatchObject({
      state: "verified",
      actor: { id: "200", role: "moderator" },
      policy: { minDuration: 1, maxDuration: 1_209_600, durationUnit: "seconds" },
    });
    await expect(
      adapter.executeTimeout({
        binding,
        actor: { id: "200", role: "moderator" },
        duration: 600,
        reason: "Spam",
      })
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({
      accessToken: "main-only-token",
      clientId: "client",
      broadcasterId: "100",
      moderatorId: "200",
      userId: "300",
      durationSeconds: 600,
      reason: "Spam",
    });
  });
});
