import { beforeEach, describe, expect, it, vi } from "vitest";

import { KICK_APP_SCOPES, TWITCH_APP_SCOPES } from "@shared/auth-types";

vi.mock("@backend/features/authentication/data/authentication-repository", () => ({
  authenticationRepository: {
    getToken: vi.fn(),
    getTwitchUser: vi.fn(),
    getKickUser: vi.fn(),
  },
}));

vi.mock("@backend/features/moderation/adapters/twitch/twitch-helix-moderation", () => ({
  getModeratedChannelsResult: vi.fn(),
}));

vi.mock("@backend/features/chat/adapters/kick/kick-send-window", () => ({
  getKickChannelViewerRole: vi.fn(),
}));

vi.mock("@backend/features/discovery/adapters/kick/channel-endpoints", () => ({
  getChannelsBySlugs: vi.fn(),
}));
vi.mock("@backend/api/platforms/kick/kick-transport", () => ({
  kickTransport: { request: vi.fn() },
}));

vi.mock("@backend/features/authentication/adapters/oauth/oauth-config", () => ({
  getOAuthConfig: vi.fn(() => ({ clientId: "client-id" })),
}));

vi.mock("@backend/features/authentication/adapters/oauth/token-exchange", () => ({
  tokenExchangeService: {
    getTokenStatus: vi.fn(),
  },
}));

import { getChannelsBySlugs } from "@backend/features/discovery/adapters/kick/channel-endpoints";
import { tokenExchangeService } from "@backend/features/authentication/adapters/oauth/token-exchange";
import { authenticationRepository } from "@backend/features/authentication/data/authentication-repository";
import { getKickChannelViewerRole } from "@backend/features/chat/adapters/kick/kick-send-window";
import { authorizeModerationHistory } from "@backend/features/moderation/adapters/platform/moderation-history-authorization";
import { getModeratedChannelsResult } from "@backend/features/moderation/adapters/twitch/twitch-helix-moderation";

const twitchInput = {
  platform: "twitch" as const,
  channelId: "channel-1",
  channelSlug: "channel",
};
const kickInput = {
  platform: "kick" as const,
  channelId: "channel-1",
  channelSlug: "channel",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getChannelsBySlugs).mockResolvedValue([
    {
      id: "channel-1",
      platform: "kick",
      username: "channel",
      displayName: "Channel",
      avatarUrl: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    },
  ]);
  vi.mocked(tokenExchangeService.getTokenStatus).mockImplementation(async (platform) => {
    const storedUser =
      platform === "twitch"
        ? vi.mocked(authenticationRepository.getTwitchUser)()
        : vi.mocked(authenticationRepository.getKickUser)();
    return {
      valid: true,
      userId: storedUser ? String(storedUser.id) : undefined,
      scopes: platform === "twitch" ? [...TWITCH_APP_SCOPES] : [...KICK_APP_SCOPES],
      expiresAt: Date.now() + 60_000,
    };
  });
});

// Guards: expired or revoked live credentials can never authorize cached broadcaster history.
// Guards: a live token identity mismatch can never inherit authority from a cached platform user.
// Guards: live platform scopes, not cached token scopes, gate moderation history.
describe("authorizeModerationHistory", () => {
  it("fails closed for a Twitch guest without calling the platform", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue(null);
    vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue(null);

    await expect(authorizeModerationHistory(twitchInput)).resolves.toEqual({
      state: "denied",
      reason: "guest",
    });
    expect(getModeratedChannelsResult).not.toHaveBeenCalled();
  });

  it("reports missing canonical Twitch scopes before checking moderator authority", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue({
      accessToken: "token",
      scope: ["user:read:moderated_channels"],
    });
    vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue({
      id: "viewer-1",
      login: "viewer",
      displayName: "Viewer",
      profileImageUrl: "",
      createdAt: "",
      broadcasterType: "",
    });
    vi.mocked(tokenExchangeService.getTokenStatus).mockResolvedValue({
      valid: true,
      userId: "viewer-1",
      scopes: ["user:read:moderated_channels"],
      expiresAt: Date.now() + 60_000,
    });

    await expect(authorizeModerationHistory(twitchInput)).resolves.toEqual({
      state: "denied",
      reason: "missing-scopes",
    });
    expect(getModeratedChannelsResult).not.toHaveBeenCalled();
  });

  it("authorizes a Twitch broadcaster from first-party identity", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue({
      accessToken: "token",
      scope: [...TWITCH_APP_SCOPES],
    });
    vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue({
      id: "channel-1",
      login: "channel",
      displayName: "Channel",
      profileImageUrl: "",
      createdAt: "",
      broadcasterType: "",
    });

    await expect(authorizeModerationHistory(twitchInput)).resolves.toEqual({
      state: "authorized",
      role: "broadcaster",
    });
  });

  it("authorizes a Twitch moderator only from a complete platform response", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue({
      accessToken: "token",
      scope: [...TWITCH_APP_SCOPES],
    });
    vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue({
      id: "viewer-1",
      login: "viewer",
      displayName: "Viewer",
      profileImageUrl: "",
      createdAt: "",
      broadcasterType: "",
    });
    vi.mocked(getModeratedChannelsResult).mockResolvedValue({
      state: "complete",
      channels: [
        {
          broadcaster_id: "channel-1",
          broadcaster_login: "channel",
          broadcaster_name: "Channel",
        },
      ],
    });

    await expect(authorizeModerationHistory(twitchInput)).resolves.toEqual({
      state: "authorized",
      role: "moderator",
    });

    vi.mocked(getModeratedChannelsResult).mockResolvedValue({
      state: "partial",
      reason: "network",
      channels: [
        {
          broadcaster_id: "channel-1",
          broadcaster_login: "channel",
          broadcaster_name: "Channel",
        },
      ],
    });
    await expect(authorizeModerationHistory(twitchInput)).resolves.toEqual({
      state: "denied",
      reason: "unverified",
    });
  });

  it("fails closed for a Kick token missing canonical scopes", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue({
      accessToken: "token",
      scope: ["user:read"],
    });
    vi.mocked(authenticationRepository.getKickUser).mockReturnValue({
      id: 42,
      username: "viewer",
      slug: "viewer",
      profilePic: "",
      verified: false,
    });
    vi.mocked(tokenExchangeService.getTokenStatus).mockResolvedValue({
      valid: true,
      userId: "42",
      scopes: ["user:read"],
      expiresAt: Date.now() + 60_000,
    });

    await expect(authorizeModerationHistory(kickInput)).resolves.toEqual({
      state: "denied",
      reason: "missing-scopes",
    });
    expect(getKickChannelViewerRole).not.toHaveBeenCalled();
  });

  it("authorizes a Kick broadcaster from first-party identity", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue({
      accessToken: "token",
      scope: [...KICK_APP_SCOPES],
    });
    vi.mocked(authenticationRepository.getKickUser).mockReturnValue({
      id: 42,
      username: "Channel",
      slug: "channel",
      profilePic: "",
      verified: false,
    });

    await expect(authorizeModerationHistory({ ...kickInput, channelId: "42" })).resolves.toEqual({
      state: "authorized",
      role: "broadcaster",
    });
    expect(getChannelsBySlugs).not.toHaveBeenCalled();
  });

  // Guards: a trusted slug can never authorize a different caller-supplied channel ID.
  it("rejects a Kick request when the slug resolves to a different canonical broadcaster", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue({
      accessToken: "token",
      scope: [...KICK_APP_SCOPES],
    });
    vi.mocked(authenticationRepository.getKickUser).mockReturnValue({
      id: 42,
      username: "Viewer",
      slug: "viewer",
      profilePic: "",
      verified: false,
    });
    vi.mocked(getChannelsBySlugs).mockResolvedValue([
      {
        id: "different-channel",
        platform: "kick",
        username: "channel",
        displayName: "Channel",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ]);

    await expect(authorizeModerationHistory(kickInput)).resolves.toEqual({
      state: "denied",
      reason: "unverified",
    });
    expect(getKickChannelViewerRole).not.toHaveBeenCalled();
  });

  it("distinguishes a verified Kick moderator, ordinary viewer, and unverifiable result", async () => {
    vi.mocked(authenticationRepository.getToken).mockReturnValue({
      accessToken: "token",
      scope: [...KICK_APP_SCOPES],
    });
    vi.mocked(authenticationRepository.getKickUser).mockReturnValue({
      id: 42,
      username: "Viewer",
      slug: "viewer",
      profilePic: "",
      verified: false,
    });

    vi.mocked(getKickChannelViewerRole).mockResolvedValue({
      ok: true,
      isModerator: true,
      status: 200,
    });
    await expect(authorizeModerationHistory(kickInput)).resolves.toEqual({
      state: "authorized",
      role: "moderator",
    });

    vi.mocked(getKickChannelViewerRole).mockResolvedValue({
      ok: true,
      isModerator: false,
      status: 200,
    });
    await expect(authorizeModerationHistory(kickInput)).resolves.toEqual({
      state: "denied",
      reason: "viewer",
    });

    vi.mocked(getKickChannelViewerRole).mockResolvedValue({
      ok: true,
      isModerator: null,
      status: 200,
    });
    await expect(authorizeModerationHistory(kickInput)).resolves.toEqual({
      state: "denied",
      reason: "unverified",
    });
  });

  it.each([
    ["twitch", "expired", { expiresAt: Date.now() - 1, valid: false, userId: undefined }],
    ["twitch", "revoked", { expiresAt: Date.now() + 60_000, valid: false, userId: undefined }],
    [
      "twitch",
      "identity mismatch",
      { expiresAt: Date.now() + 60_000, valid: true, userId: "other" },
    ],
    ["kick", "expired", { expiresAt: Date.now() - 1, valid: false, userId: undefined }],
    ["kick", "revoked", { expiresAt: Date.now() + 60_000, valid: false, userId: undefined }],
    ["kick", "identity mismatch", { expiresAt: Date.now() + 60_000, valid: true, userId: "99" }],
  ] as const)(
    "fails closed for a %s %s credential before broadcaster or moderator checks",
    async (platform, _scenario, liveStatus) => {
      const isTwitch = platform === "twitch";
      vi.mocked(authenticationRepository.getToken).mockReturnValue({
        accessToken: "cached-token",
        expiresAt: liveStatus.expiresAt,
        scope: isTwitch ? [...TWITCH_APP_SCOPES] : [...KICK_APP_SCOPES],
      });
      if (isTwitch) {
        vi.mocked(authenticationRepository.getTwitchUser).mockReturnValue({
          id: "channel-1",
          login: "channel",
          displayName: "Channel",
          profileImageUrl: "",
          createdAt: "",
          broadcasterType: "",
        });
      } else {
        vi.mocked(authenticationRepository.getKickUser).mockReturnValue({
          id: 42,
          username: "Channel",
          slug: "channel",
          profilePic: "",
          verified: false,
        });
      }
      vi.mocked(tokenExchangeService.getTokenStatus).mockResolvedValue({
        ...liveStatus,
        scopes: isTwitch ? [...TWITCH_APP_SCOPES] : [...KICK_APP_SCOPES],
      });

      await expect(authorizeModerationHistory(isTwitch ? twitchInput : kickInput)).resolves.toEqual(
        {
          state: "denied",
          reason: "unverified",
        }
      );
      expect(tokenExchangeService.getTokenStatus).toHaveBeenCalledWith(
        platform,
        expect.objectContaining({ accessToken: "cached-token" })
      );
      expect(getModeratedChannelsResult).not.toHaveBeenCalled();
      expect(getKickChannelViewerRole).not.toHaveBeenCalled();
    }
  );
});
