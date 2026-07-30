import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  isAuthenticated: vi.fn(),
  getUsersById: vi.fn(),
  getUsersByLogin: vi.fn(),
  getChannelByLogin: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: { getToken: mocks.getToken },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    isAuthenticated: mocks.isAuthenticated,
    getUsersById: mocks.getUsersById,
    getUsersByLogin: mocks.getUsersByLogin,
    getChannelByLogin: mocks.getChannelByLogin,
    request: mocks.request,
  },
}));

import {
  getTwitchAccountCreated,
  getTwitchFollowRelationship,
  getTwitchPublicIdentity,
} from "@/backend/api/platforms/twitch/twitch-public-profile-reader";

// Guards: account creation prefers an exact official Helix timestamp before the validated website fallback.
// Guards: a signed-in token missing follower scope produces a real reconnect-required field state.
describe("Twitch public profile reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthenticated.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a guest viewer's validated first-party followedAt without user auth", async () => {
    mocks.getToken.mockReturnValue(null);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          user: {
            id: "user",
            login: "alice",
            follow: { followedAt: "2020-01-01T00:00:00Z" },
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "known",
      source: "first-party-fallback",
      value: "2020-01-01T00:00:00Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gql.twitch.tv/gql",
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
        body: expect.stringContaining('"targetID":"channel"'),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("returns not-following only when a well-formed first-party response has a null follow", async () => {
    mocks.getToken.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            user: {
              id: "user",
              login: "alice",
              follow: null,
            },
          },
        }),
      }))
    );

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "negative",
      source: "first-party-fallback",
    });
  });

  it("keeps a GraphQL error retryable even when partial follow data is present", async () => {
    mocks.getToken.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          errors: [{ message: "resolver failed" }],
          data: {
            user: {
              id: "user",
              login: "alice",
              follow: { followedAt: "2020-01-01T00:00:00Z" },
            },
          },
        }),
      }))
    );

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
  });

  it("keeps a malformed first-party follow response retryable", async () => {
    mocks.getToken.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { user: { id: "user", login: "alice" } } }),
      }))
    );

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
  });

  it("keeps a failed first-party HTTP request retryable", async () => {
    mocks.getToken.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
      }))
    );

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
  });

  it("keeps an identity-mismatched first-party follow response retryable", async () => {
    mocks.getToken.mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            user: {
              id: "different-user",
              login: "mallory",
              follow: { followedAt: "2020-01-01T00:00:00Z" },
            },
          },
        }),
      }))
    );

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
  });

  it("disambiguates an empty Helix row through the public tuple lookup", async () => {
    mocks.getToken.mockReturnValue({
      accessToken: "secret",
      scope: ["moderator:read:followers"],
    });
    mocks.request.mockResolvedValue({ data: [] });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          user: {
            id: "user",
            login: "alice",
            follow: null,
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "negative",
      source: "first-party-fallback",
    });
    expect(mocks.request).toHaveBeenCalledWith(
      "/channels/followers?broadcaster_id=channel&user_id=user&first=1"
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("prefers a nonempty privileged Helix result without invoking the fallback", async () => {
    mocks.getToken.mockReturnValue({
      accessToken: "secret",
      scope: ["moderator:read:followers"],
    });
    mocks.request.mockResolvedValue({
      data: [{ followed_at: "2020-01-01T00:00:00Z" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "known",
      source: "official",
      value: "2020-01-01T00:00:00Z",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires reconnect when a signed-in token lacks the canonical follower scope", async () => {
    mocks.getToken.mockReturnValue({ accessToken: "secret", scope: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "reconnect-required",
      missingScopes: ["moderator:read:followers"],
    });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects first-party schema drift instead of inventing an account-created date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { user: { id: "u1", login: "alice" } } }),
      }))
    );

    await expect(getTwitchPublicIdentity("u1", "alice")).resolves.toEqual({
      state: "failed",
      message: "Couldn’t verify",
    });
  });

  it("retains the exact validated Twitch GQL profile image URL for a guest viewer", async () => {
    const avatarUrl =
      "https://static-cdn.jtvnw.net/jtv_user_pictures/alice-profile_image-0123456789abcdef-300x300.jpeg";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          user: {
            id: "u1",
            login: "alice",
            displayName: "Alice",
            profileImageURL: avatarUrl,
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTwitchPublicIdentity("u1", "alice")).resolves.toEqual({
      state: "known",
      source: "first-party-fallback",
      value: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gql.twitch.tv/gql",
      expect.objectContaining({
        body: expect.stringContaining("profileImageURL(width: 300)"),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("rejects a first-party identity that does not match the clicked user id and login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            user: {
              id: "different-user",
              login: "mallory",
              displayName: "Mallory",
              profileImageURL: "",
            },
          },
        }),
      }))
    );

    await expect(getTwitchPublicIdentity("u1", "alice")).resolves.toMatchObject({
      state: "failed",
    });
  });

  it("accepts a valid account-created fallback only when it matches clicked identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            user: {
              id: "u1",
              login: "alice",
              displayName: "Alice",
              profileImageURL: "",
              createdAt: "2012-05-06T00:00:00Z",
            },
          },
        }),
      }))
    );
    await expect(getTwitchAccountCreated("u1", "alice")).resolves.toEqual({
      state: "known",
      source: "first-party-fallback",
      value: "2012-05-06T00:00:00Z",
    });
    await expect(getTwitchAccountCreated("different", "alice")).resolves.toEqual({
      state: "failed",
      message: "Couldn’t verify",
    });
  });

  it("prefers an exact official Helix account-created timestamp without invoking GQL", async () => {
    mocks.isAuthenticated.mockReturnValue(true);
    mocks.getUsersById.mockResolvedValue([
      {
        id: "u1",
        login: "alice",
        displayName: "Alice",
        profileImageUrl: "",
        createdAt: "2012-05-06T00:00:00Z",
      },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTwitchAccountCreated("u1", "alice")).resolves.toEqual({
      state: "known",
      source: "official",
      value: "2012-05-06T00:00:00Z",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a matched account-created fallback with a malformed timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            user: {
              id: "u1",
              login: "alice",
              displayName: "Alice",
              profileImageURL: "",
              createdAt: "not-a-date",
            },
          },
        }),
      }))
    );

    await expect(getTwitchAccountCreated("u1", "alice")).resolves.toMatchObject({
      state: "failed",
    });
  });

  it("does not mislabel a 403 authority failure as a missing-scope reconnect", async () => {
    mocks.getToken.mockReturnValue({
      accessToken: "secret",
      scope: ["moderator:read:followers"],
    });
    mocks.request.mockRejectedValue({ status: 403 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: { user: null } }) }))
    );
    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
  });

  it("falls back publicly when Helix rejects an ordinary viewer's authority", async () => {
    mocks.getToken.mockReturnValue({
      accessToken: "secret",
      scope: ["moderator:read:followers"],
    });
    mocks.request.mockRejectedValue({ status: 403 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            user: {
              id: "user",
              login: "alice",
              follow: { followedAt: "2020-01-01T00:00:00Z" },
            },
          },
        }),
      }))
    );

    await expect(getTwitchFollowRelationship("channel", "user", "alice")).resolves.toEqual({
      state: "known",
      source: "first-party-fallback",
      value: "2020-01-01T00:00:00Z",
    });
  });
});
