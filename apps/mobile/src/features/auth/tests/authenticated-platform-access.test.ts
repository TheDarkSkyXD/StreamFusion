import { describe, expect, it, vi } from "vitest";
import {
  kickAccountId,
  kickCredentialGeneration,
  twitchAccountId,
  twitchCredentialGeneration,
  type TwitchCredentialRepository,
  type KickCredentialRepository,
} from "@streamfusion/core/auth";
import type { TwitchAccountSessionSnapshot } from "../domain/twitch-account-session-controller";
import { createAuthenticatedPlatformAccess } from "../adapters/authenticated-platform-access";

function setup() {
  let snapshot: TwitchAccountSessionSnapshot = {
    kind: "connected",
    login: "owner",
    displayName: "Owner",
    profileImageUrl: null,
    scopes: ["user:write:chat"],
    missingScopes: [],
    expiresAtEpochMs: 600_000,
    validatedAtEpochMs: 0,
    refreshing: false,
    view: "summary",
  };
  const repository = {
    read: vi.fn<TwitchCredentialRepository["read"]>().mockResolvedValue({
      kind: "ready",
      credential: {
        account: {
          id: twitchAccountId("42"),
          login: "owner",
          displayName: "Owner",
          profileImageUrl: null,
        },
        accessToken: "secret",
        refreshToken: "refresh-secret",
        expiresAtEpochMs: 600_000,
        validatedAtEpochMs: 0,
        scopes: ["user:write:chat"],
        generation: twitchCredentialGeneration(1),
      },
    }),
  };
  const refresh = vi.fn(async () => {});
  let fixture = false;
  const unsubscribe = vi.fn();
  const access = createAuthenticatedPlatformAccess({
    twitch: {
      clientId: "client",
      repository,
      controller: {
        getSnapshot: () => snapshot,
        refresh,
        subscribe: () => unsubscribe,
      },
    },
    kick: {
      clientId: async () => "kick-client",
      repository: { read: vi.fn<KickCredentialRepository["read"]>() },
      controller: {
        getSnapshot: () => ({ kind: "disconnected" }),
        refresh: async () => {},
        subscribe: () => unsubscribe,
      },
    },
    fixtureEnabled: () => fixture,
    now: () => 100_000,
  });
  return {
    access,
    repository,
    refresh,
    unsubscribe,
    fixture: () => {
      fixture = true;
    },
    disconnect: () => {
      snapshot = { kind: "disconnected" };
    },
    expiring: () => {
      if (snapshot.kind === "connected")
        snapshot = { ...snapshot, expiresAtEpochMs: 120_000 };
    },
  };
}
describe("production platform access", () => {
  it("resolves a connected Kick account's public ID when an action needs it", async () => {
    const clientId = vi.fn(async () => "resolved-kick-client");
    const account = {
      kind: "connected" as const,
      login: "kick-owner",
      displayName: "Kick Owner",
      profileImageUrl: null,
      scopes: ["chat:write"],
      missingScopes: [],
      expiresAtEpochMs: 600_000,
      validatedAtEpochMs: 0,
      refreshing: false,
      view: "summary" as const,
    };
    const access = createAuthenticatedPlatformAccess({
      twitch: {
        clientId: "twitch-client",
        repository: { read: vi.fn<TwitchCredentialRepository["read"]>() },
        controller: {
          getSnapshot: () => ({ kind: "disconnected" }),
          refresh: async () => {},
          subscribe: () => () => {},
        },
      },
      kick: {
        clientId,
        repository: {
          read: async () => ({
            kind: "ready",
            credential: {
              account: {
                id: kickAccountId("kick-42"),
                login: "kick-owner",
                displayName: "Kick Owner",
                profileImageUrl: null,
              },
              accessToken: "kick-secret",
              refreshToken: "kick-refresh",
              generation: kickCredentialGeneration(1),
              scopes: ["chat:write"],
              expiresAtEpochMs: 600_000,
              validatedAtEpochMs: 0,
            },
          }),
        },
        controller: {
          getSnapshot: () => account,
          refresh: async () => {},
          subscribe: () => () => {},
        },
      },
      fixtureEnabled: () => false,
      now: () => 100_000,
    });
    expect(clientId).not.toHaveBeenCalled();
    expect(await access.read("kick", ["chat:write"])).toMatchObject({
      kind: "ready",
      clientId: "resolved-kick-client",
      userId: "kick-42",
      accessToken: "kick-secret",
    });
    expect(clientId).toHaveBeenCalledOnce();
  });
  it("does not return a Kick token after disconnect during public ID resolution", async () => {
    const pendingId = Promise.withResolvers<string>();
    const clientId = vi.fn(() => pendingId.promise);
    let connected = true;
    const credential = {
      account: {
        id: kickAccountId("kick-42"),
        login: "kick-owner",
        displayName: "Kick Owner",
        profileImageUrl: null,
      },
      accessToken: "previous-token",
      refreshToken: "kick-refresh",
      generation: kickCredentialGeneration(1),
      scopes: ["chat:write"],
      expiresAtEpochMs: 600_000,
      validatedAtEpochMs: 0,
    };
    const access = createAuthenticatedPlatformAccess({
      twitch: {
        clientId: "twitch-client",
        repository: { read: vi.fn<TwitchCredentialRepository["read"]>() },
        controller: {
          getSnapshot: () => ({ kind: "disconnected" }),
          refresh: async () => {},
          subscribe: () => () => {},
        },
      },
      kick: {
        clientId,
        repository: {
          read: async () =>
            connected
              ? { kind: "ready" as const, credential }
              : {
                  kind: "disconnected" as const,
                  generation: kickCredentialGeneration(2),
                },
        },
        controller: {
          getSnapshot: () =>
            connected
              ? {
                  kind: "connected" as const,
                  login: "kick-owner",
                  displayName: "Kick Owner",
                  profileImageUrl: null,
                  scopes: ["chat:write"],
                  missingScopes: [],
                  expiresAtEpochMs: 600_000,
                  validatedAtEpochMs: 0,
                  refreshing: false,
                  view: "summary" as const,
                }
              : { kind: "disconnected" as const },
          refresh: async () => {},
          subscribe: () => () => {},
        },
      },
      fixtureEnabled: () => false,
      now: () => 100_000,
    });
    const reading = access.read("kick", ["chat:write"]);
    await vi.waitFor(() => expect(clientId).toHaveBeenCalledOnce());
    connected = false;
    pendingId.resolve("public-kick-client");
    expect(await reading).toMatchObject({ kind: "blocked", reason: "sign-in" });
  });
  it("returns only a current credential with the required grants", async () => {
    const { access } = setup();
    expect(await access.read("twitch", ["user:write:chat"])).toMatchObject({
      kind: "ready",
      userId: "42",
      username: "owner",
      accessToken: "secret",
      generation: 1,
    });
    expect(
      await access.read("twitch", ["moderator:manage:banned_users"]),
    ).toMatchObject({ kind: "blocked", reason: "scope" });
  });
  it("rejects fixture accounts before reading secrets", async () => {
    const { access, repository, fixture } = setup();
    fixture();
    expect(await access.read("twitch")).toMatchObject({
      kind: "blocked",
      reason: "fixture",
    });
    expect(repository.read).not.toHaveBeenCalled();
  });
  it("rechecks the account after an asynchronous credential read", async () => {
    const { access, repository, disconnect } = setup();
    const original = repository.read.getMockImplementation()!;
    repository.read.mockImplementation(async () => {
      disconnect();
      return original();
    });
    expect(await access.read("twitch")).toMatchObject({
      kind: "blocked",
      reason: "expired",
    });
  });
  it("refreshes an expiring session and removes both subscriptions", async () => {
    const { access, refresh, expiring, unsubscribe } = setup();
    expiring();
    await access.read("twitch");
    expect(refresh).toHaveBeenCalledOnce();
    access.subscribe(() => {})();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
