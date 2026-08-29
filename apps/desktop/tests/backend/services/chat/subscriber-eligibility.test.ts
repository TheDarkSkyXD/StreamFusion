// Guards: subscriber-only eligibility preflight blocks only on definite Twitch/Kick signals and treats Kick web-session ambiguity as unknown.

import type { AuthToken, TwitchUser } from "@shared/auth-types";
import type { SubscriberEligibilityRequest } from "@shared/chat-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getToken: vi.fn(),
  getTwitchUser: vi.fn(),
}));

const kickSubscriptionsMock = vi.hoisted(() => ({
  fetchKickUserSubscriptions: vi.fn(),
}));

vi.mock("@backend/services/storage-service", () => ({
  storageService: storageMock,
}));

vi.mock("@backend/services/emotes/kick-user-subscriptions-service", () => kickSubscriptionsMock);

import {
  checkKickSubscriberEligibility,
  checkTwitchSubscriberEligibility,
  parseKickSubscriberEligibility,
} from "@backend/services/chat/subscriber-eligibility";

const twitchRequest: SubscriberEligibilityRequest = {
  platform: "twitch",
  channel: "ninja",
  channelId: "12345",
};

const kickRequest: SubscriberEligibilityRequest = {
  platform: "kick",
  channel: "xqc",
  channelId: "98765",
};

const token: AuthToken = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 60_000,
  scope: ["user:read:subscriptions"],
};

const twitchUser: TwitchUser = {
  id: "viewer-1",
  login: "viewer",
  displayName: "Viewer",
  profileImageUrl: "",
  email: undefined,
  broadcasterType: "",
  createdAt: "",
};

beforeEach(() => {
  storageMock.getToken.mockReset();
  storageMock.getTwitchUser.mockReset();
  kickSubscriptionsMock.fetchKickUserSubscriptions.mockReset();
});

describe("subscriber eligibility preflight", () => {
  it("Twitch: returns subscribed when Helix returns subscription data", async () => {
    storageMock.getToken.mockReturnValue(token);
    storageMock.getTwitchUser.mockReturnValue(twitchUser);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ broadcaster_id: "12345" }] }),
    })) as unknown as typeof fetch;

    await expect(checkTwitchSubscriberEligibility(twitchRequest, fetchImpl)).resolves.toEqual({
      status: "subscribed",
    });
  });

  it("Twitch: returns notSubscribed when Helix returns no subscription rows", async () => {
    storageMock.getToken.mockReturnValue(token);
    storageMock.getTwitchUser.mockReturnValue(twitchUser);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch;

    await expect(checkTwitchSubscriberEligibility(twitchRequest, fetchImpl)).resolves.toEqual({
      status: "notSubscribed",
    });
  });

  it("Twitch: returns missingScopes before Helix when the stored token lacks user:read:subscriptions", async () => {
    storageMock.getToken.mockReturnValue({ ...token, scope: ["chat:read"] });
    storageMock.getTwitchUser.mockReturnValue(twitchUser);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(checkTwitchSubscriberEligibility(twitchRequest, fetchImpl)).resolves.toEqual({
      status: "missingScopes",
      missingScopes: ["user:read:subscriptions"],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Kick: parses subscribed from nested subscription payloads", () => {
    expect(
      parseKickSubscriberEligibility(
        { data: [{ channel: { slug: "xqc", id: 98765 } }] },
        kickRequest
      )
    ).toEqual({ status: "subscribed" });
  });

  it("Kick: parses notSubscribed from a known subscription list with no matching channel", () => {
    expect(
      parseKickSubscriberEligibility({ data: [{ channel: { slug: "summit1g" } }] }, kickRequest)
    ).toEqual({ status: "notSubscribed" });
  });

  it("Kick: returns unknown when the web-session payload is unavailable or ambiguous", async () => {
    kickSubscriptionsMock.fetchKickUserSubscriptions.mockResolvedValue(null);

    await expect(checkKickSubscriberEligibility(kickRequest)).resolves.toEqual({
      status: "unknown",
    });
    expect(parseKickSubscriberEligibility({ message: "not an inventory" }, kickRequest)).toEqual({
      status: "unknown",
    });
  });
});
