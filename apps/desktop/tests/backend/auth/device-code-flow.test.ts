import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/managed-interval", () => ({
  createManagedInterval: vi.fn((callback: () => void, ms: number) => {
    const id = setInterval(callback, ms);
    return { stop: () => clearInterval(id) };
  }),
}));

vi.mock("@/backend/auth/oauth-config", () => ({
  getOAuthConfig: vi.fn(() => ({
    platform: "twitch",
    clientId: "test-client-id",
    clientSecret: "",
    authorizationEndpoint: "https://id.twitch.tv/oauth2/authorize",
    tokenEndpoint: "https://worker.test/auth/twitch/token",
    scopes: ["chat:read"],
    usesPkce: true,
  })),
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

import { deviceCodeFlowService } from "@/backend/auth/device-code-flow";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  deviceCodeFlowService.stopPolling();
});

afterEach(() => {
  deviceCodeFlowService.stopPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("requestDeviceCode", () => {
  it("posts to the device auth endpoint and returns parsed result", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        device_code: "dc-123",
        user_code: "ABCD-EFGH",
        verification_uri: "https://www.twitch.tv/activate",
        expires_in: 900,
        interval: 5,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deviceCodeFlowService.requestDeviceCode(["chat:read", "chat:edit"]);

    expect(result).toEqual({
      deviceCode: "dc-123",
      userCode: "ABCD-EFGH",
      verificationUri: "https://www.twitch.tv/activate",
      expiresIn: 900,
      interval: 5,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://id.twitch.tv/oauth2/device");
    expect(init.method).toBe("POST");
    const body = init.body as string;
    expect(body).toContain("client_id=test-client-id");
    expect(body).toContain("scopes=chat%3Aread+chat%3Aedit");
  });

  it("throws when client ID is not set", async () => {
    const { getOAuthConfig } = await import("@/backend/auth/oauth-config");
    vi.mocked(getOAuthConfig).mockReturnValueOnce({
      platform: "twitch",
      clientId: "",
      clientSecret: "",
      authorizationEndpoint: "",
      tokenEndpoint: "",
      scopes: [],
      usesPkce: false,
    });

    await expect(deviceCodeFlowService.requestDeviceCode(["chat:read"])).rejects.toThrow(
      "TWITCH_CLIENT_ID not set"
    );
  });

  it("throws with error_description from non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "invalid_client", error_description: "Bad client" }, false, 400)
      )
    );

    await expect(deviceCodeFlowService.requestDeviceCode(["chat:read"])).rejects.toThrow(
      "Bad client"
    );
  });

  it("throws generic message when error response has no description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "server_error" }, false, 500))
    );

    await expect(deviceCodeFlowService.requestDeviceCode(["chat:read"])).rejects.toThrow(
      "Failed to request device code"
    );
  });

  it("throws generic message when error JSON is unparseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("bad json");
        },
      }))
    );

    await expect(deviceCodeFlowService.requestDeviceCode(["chat:read"])).rejects.toThrow(
      "Failed to request device code"
    );
  });
});

describe("pollForToken", () => {
  it("resolves with token when user authorizes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        access_token: "at-123",
        refresh_token: "rt-456",
        token_type: "bearer",
        expires_in: 14400,
        scope: "chat:read chat:edit",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const statusChanges: string[] = [];
    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900, (status) => {
      statusChanges.push(status);
    });

    await vi.advanceTimersByTimeAsync(0);

    const token = await promise;

    expect(token.accessToken).toBe("at-123");
    expect(token.refreshToken).toBe("rt-456");
    expect(token.expiresAt).toBe(Date.now() + 14400 * 1000);
    expect(token.scope).toEqual(["chat:read", "chat:edit"]);
    expect(statusChanges).toContain("authorized");
  });

  it("handles scope as array in token response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          access_token: "at",
          token_type: "bearer",
          scope: ["a", "b"],
        })
      )
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900);
    await vi.advanceTimersByTimeAsync(0);
    const token = await promise;

    expect(token.scope).toEqual(["a", "b"]);
  });

  it("keeps polling on authorization_pending", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++;
        if (callCount <= 2) {
          return jsonResponse({ error: "authorization_pending" }, false, 400);
        }
        return jsonResponse({
          access_token: "at",
          token_type: "bearer",
        });
      })
    );

    const statusChanges: string[] = [];
    const promise = deviceCodeFlowService.pollForToken("dc", 1, 60, (status) => {
      statusChanges.push(status);
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const token = await promise;

    expect(token.accessToken).toBe("at");
    expect(statusChanges.filter((s) => s === "pending").length).toBeGreaterThanOrEqual(1);
  });

  it("rejects on access_denied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "access_denied" }, false, 400))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900);
    const caught = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(0);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Authorization denied by user");
  });

  it("rejects on expired_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "expired_token" }, false, 400))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900);
    const caught = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(0);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Device code expired");
  });

  it("rejects on unknown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "something_weird", error_description: "Weird thing" }, false, 400)
      )
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900);
    const caught = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(0);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Weird thing");
  });

  it("rejects when device code expires by time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "authorization_pending" }, false, 400))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 1, 3);
    const caught = promise.catch((err: Error) => err);

    await vi.advanceTimersByTimeAsync(4000);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Device code expired");
  });

  it("continues polling on network error (does not reject)", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("network");
        return jsonResponse({ access_token: "at", token_type: "bearer" });
      })
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 1, 60);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const token = await promise;
    expect(token.accessToken).toBe("at");
  });

  it("calls onStatusChange with error for unknown errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "bad_thing" }, false, 400))
    );

    const statuses: Array<{ status: string; message?: string }> = [];
    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900, (status, message) => {
      statuses.push({ status, message });
    });
    const caught = promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await caught;

    expect(statuses).toContainEqual(expect.objectContaining({ status: "error" }));
  });
});

describe("stopPolling", () => {
  it("is safe to call when not polling", () => {
    expect(() => deviceCodeFlowService.stopPolling()).not.toThrow();
  });
});

describe("isPolling", () => {
  it("returns false when not polling", () => {
    expect(deviceCodeFlowService.isPolling()).toBe(false);
  });

  it("returns true during active polling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "authorization_pending" }, false, 400))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 1, 60);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(deviceCodeFlowService.isPolling()).toBe(true);

    deviceCodeFlowService.stopPolling();
  });
});
