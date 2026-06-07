import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { oauthCallbackServer } from "@/backend/auth/oauth-callback-server";

afterEach(() => {
  oauthCallbackServer.stop();
});

function waitForServer(ms = 100): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("getRedirectUri", () => {
  it("returns the localhost redirect URI for the given platform", () => {
    const uri = oauthCallbackServer.getRedirectUri("twitch");
    expect(uri).toMatch(/^http:\/\/localhost:\d+\/auth\/twitch\/callback$/);
  });

  it("includes the correct platform in the path", () => {
    const uri = oauthCallbackServer.getRedirectUri("kick");
    expect(uri).toContain("/auth/kick/callback");
  });
});

describe("getPort", () => {
  it("returns a numeric port", () => {
    expect(typeof oauthCallbackServer.getPort()).toBe("number");
  });
});

describe("stop", () => {
  it("is safe to call when no server is running", () => {
    expect(() => oauthCallbackServer.stop()).not.toThrow();
  });
});

describe("waitForCallback", () => {
  it("resolves with code and state on a valid callback", async () => {
    const port = 19876;
    const state = "test-state-123";

    const promise = oauthCallbackServer.waitForCallback("twitch", state, {
      port,
      timeout: 5000,
    });

    await waitForServer();

    const response = await fetch(
      `http://localhost:${port}/auth/twitch/callback?code=AUTH_CODE&state=${state}`
    );
    expect(response.status).toBe(200);

    const result = await promise;
    expect(result.code).toBe("AUTH_CODE");
    expect(result.state).toBe(state);
  });

  it("rejects on state mismatch", async () => {
    const port = 19877;

    const promise = oauthCallbackServer.waitForCallback("twitch", "expected-state", {
      port,
      timeout: 5000,
    });

    await waitForServer();

    const caught = promise.catch((err: Error) => err);

    await fetch(`http://localhost:${port}/auth/twitch/callback?code=CODE&state=wrong-state`);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("State mismatch");
  });

  it("rejects when callback carries an error parameter", async () => {
    const port = 19878;

    const promise = oauthCallbackServer.waitForCallback("twitch", "s", {
      port,
      timeout: 5000,
    });

    await waitForServer();

    const caught = promise.catch((err: Error) => err);

    await fetch(
      `http://localhost:${port}/auth/twitch/callback?error=access_denied&error_description=User+denied`
    );

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("User denied");
  });

  it("rejects when error has no description", async () => {
    const port = 19879;

    const promise = oauthCallbackServer.waitForCallback("twitch", "s", {
      port,
      timeout: 5000,
    });

    await waitForServer();

    const caught = promise.catch((err: Error) => err);

    await fetch(`http://localhost:${port}/auth/twitch/callback?error=access_denied`);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("access_denied");
  });

  it("rejects when code or state is missing", async () => {
    const port = 19880;

    const promise = oauthCallbackServer.waitForCallback("twitch", "s", {
      port,
      timeout: 5000,
    });

    await waitForServer();

    const caught = promise.catch((err: Error) => err);

    await fetch(`http://localhost:${port}/auth/twitch/callback`);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Invalid callback: missing code or state");
  });

  it("returns 404 for non-callback paths", async () => {
    const port = 19881;

    oauthCallbackServer.waitForCallback("twitch", "s", {
      port,
      timeout: 5000,
    }).catch(() => {});

    await waitForServer();

    const response = await fetch(`http://localhost:${port}/something/else`);
    expect(response.status).toBe(404);

    oauthCallbackServer.stop();
  });

  it("rejects on timeout when no callback is received", async () => {
    const port = 19882;

    const promise = oauthCallbackServer.waitForCallback("twitch", "s", {
      port,
      timeout: 200,
    });

    const caught = promise.catch((err: Error) => err);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("OAuth timeout");
  });

  it("works with kick platform", async () => {
    const port = 19883;
    const state = "kick-state";

    const promise = oauthCallbackServer.waitForCallback("kick", state, {
      port,
      timeout: 5000,
    });

    await waitForServer();

    await fetch(`http://localhost:${port}/auth/kick/callback?code=KICK_CODE&state=${state}`);

    const result = await promise;
    expect(result.code).toBe("KICK_CODE");
    expect(result.state).toBe(state);
  });

  it("ignores duplicate callbacks after the first resolution", async () => {
    const port = 19884;
    const state = "dup-state";

    const promise = oauthCallbackServer.waitForCallback("twitch", state, {
      port,
      timeout: 5000,
    });

    await waitForServer();

    await fetch(`http://localhost:${port}/auth/twitch/callback?code=FIRST&state=${state}`);

    const result = await promise;
    expect(result.code).toBe("FIRST");
  });
});
