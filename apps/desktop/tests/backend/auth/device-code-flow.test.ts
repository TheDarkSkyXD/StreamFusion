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
    tokenEndpoint: "https://id.twitch.tv/oauth2/token",
    scopes: ["chat:read"],
    usesPkce: true,
  })),
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

import { deviceCodeFlowService, runTwitchDeviceCodeLogin } from "@/backend/auth/device-code-flow";
import { createManagedInterval } from "@/lib/managed-interval";

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
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
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

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
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

  // Guards: malformed Twitch DCF responses cannot create unbounded or zero-delay polling loops.
  it("rejects device responses with invalid codes or timing bounds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          device_code: "",
          user_code: "ABCD-EFGH",
          verification_uri: "https://www.twitch.tv/activate",
          expires_in: 900,
          interval: 0,
        })
      )
    );

    await expect(deviceCodeFlowService.requestDeviceCode(["chat:read"])).rejects.toThrow(
      "Invalid device code response"
    );
  });

  it("rejects a device response that points outside the canonical Twitch activation page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          device_code: "dc-123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://user@www.twitch.tv:444/activate",
          expires_in: 900,
          interval: 5,
        })
      )
    );

    await expect(deviceCodeFlowService.requestDeviceCode(["chat:read"])).rejects.toThrow(
      "Invalid device code response"
    );
  });
});

describe("pollForToken", () => {
  it("resolves with token when user authorizes", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
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
    const promise = deviceCodeFlowService.pollForToken(
      "dc",
      5,
      900,
      ["chat:read", "chat:edit"],
      (status) => {
        statusChanges.push(status);
      }
    );

    await vi.advanceTimersByTimeAsync(0);

    const token = await promise;

    expect(token.accessToken).toBe("at-123");
    expect(token.refreshToken).toBe("rt-456");
    expect(token.expiresAt).toBe(Date.now() + 14400 * 1000);
    expect(token.scope).toEqual(["chat:read", "chat:edit"]);
    expect(token.authFlow).toBe("device-code");
    expect(statusChanges).toContain("authorized");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      "client_id=test-client-id&device_code=dc&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&scopes=chat%3Aread+chat%3Aedit"
    );
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

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900, []);
    await vi.advanceTimersByTimeAsync(0);
    const token = await promise;

    expect(token.scope).toEqual(["a", "b"]);
  });

  it("rejects malformed successful token responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ access_token: "", refresh_token: "rt", token_type: "bearer" })
      )
    );

    const polling = deviceCodeFlowService.pollForToken("dc", 5, 900, []);
    const caught = polling.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(0);

    await expect(caught).resolves.toMatchObject({ message: "Invalid token response" });
  });

  it.each([
    "error",
    "message",
  ] as const)("keeps polling when authorization_pending is returned in %s", async (statusField) => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++;
        if (callCount <= 2) {
          return jsonResponse({ [statusField]: "authorization_pending" }, false, 400);
        }
        return jsonResponse({
          access_token: "at",
          token_type: "bearer",
        });
      })
    );

    const statusChanges: string[] = [];
    const promise = deviceCodeFlowService.pollForToken("dc", 1, 60, [], (status) => {
      statusChanges.push(status);
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const token = await promise;

    expect(token.accessToken).toBe("at");
    expect(statusChanges.filter((s) => s === "pending").length).toBeGreaterThanOrEqual(1);
  });

  // Guards: Twitch slow_down responses must change the cadence of future polls, not only mutate a dead local value.
  it.each([
    "error",
    "message",
  ] as const)("reschedules future polls five seconds later when slow_down is returned in %s", async (statusField) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ [statusField]: "slow_down" }, false, 400))
        .mockResolvedValueOnce(jsonResponse({ access_token: "at", token_type: "bearer" }))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 1, 60, []);
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.mocked(createManagedInterval)).toHaveBeenLastCalledWith(expect.any(Function), 6000);

    await vi.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toMatchObject({ accessToken: "at" });
  });

  it("rejects on access_denied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "access_denied" }, false, 400))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900, []);
    const caught = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(0);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Authorization denied by user");
  });

  it("rejects on expired_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "expired_token" }, false, 400))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900, []);
    const caught = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(0);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Device code expired");
  });

  it("rejects on unknown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "something_weird", error_description: "Weird thing" }, false, 400)
      )
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900, []);
    const caught = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(0);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Weird thing");
  });

  it("rejects when device code expires by time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "authorization_pending" }, false, 400))
    );

    const promise = deviceCodeFlowService.pollForToken("dc", 1, 3, []);
    const caught = promise.catch((err: Error) => err);

    await vi.advanceTimersByTimeAsync(4000);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Device code expired");
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

    const promise = deviceCodeFlowService.pollForToken("dc", 1, 60, []);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const token = await promise;
    expect(token.accessToken).toBe("at");
  });

  // Guards: cancellation aborts an in-flight token request and rejects the public poll Promise.
  it("settles promptly when polling is cancelled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          })
      )
    );
    const cancellation = new AbortController();
    const polling = deviceCodeFlowService.pollForToken(
      "dc",
      5,
      900,
      [],
      undefined,
      cancellation.signal
    );
    const caught = polling.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(0);

    cancellation.abort();

    await expect(caught).resolves.toMatchObject({ message: "Authorization cancelled" });
    expect(deviceCodeFlowService.isPolling()).toBe(false);
  });

  // Guards: a slow Twitch token response cannot cause overlapping interval requests.
  it("serializes polling while a token request is still in flight", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const cancellation = new AbortController();
    const polling = deviceCodeFlowService.pollForToken(
      "dc",
      1,
      60,
      [],
      undefined,
      cancellation.signal
    );
    const caught = polling.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    cancellation.abort();
    await caught;
  });

  it("calls onStatusChange with error for unknown errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "bad_thing" }, false, 400))
    );

    const statuses: Array<{ status: string; message?: string }> = [];
    const promise = deviceCodeFlowService.pollForToken("dc", 5, 900, [], (status, message) => {
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

    const promise = deviceCodeFlowService.pollForToken("dc", 1, 60, []);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(deviceCodeFlowService.isPolling()).toBe(true);

    deviceCodeFlowService.stopPolling();
  });
});

describe("runTwitchDeviceCodeLogin", () => {
  // Guards: Twitch-provided verification query values cannot replace the device code or public-client marker.
  it("opens a canonical prefilled Twitch verification URL and polls to completion", async () => {
    const closePopup = vi.fn();
    const openVerificationWindow = vi.fn(async () => ({
      closed: new Promise<void>(() => undefined),
      close: closePopup,
    }));
    const pollForToken = vi.fn(async () => ({
      accessToken: "at",
      refreshToken: "rt",
      authFlow: "device-code" as const,
    }));

    const token = await runTwitchDeviceCodeLogin(["chat:read"], {
      requestDeviceCode: vi.fn(async () => ({
        deviceCode: "dc",
        userCode: "ABCD-EFGH",
        verificationUri:
          "https://www.twitch.tv/activate?public=false&device-code=attacker&extra=discard-me",
        expiresIn: 900,
        interval: 5,
      })),
      openVerificationWindow,
      pollForToken,
    });

    expect(openVerificationWindow).toHaveBeenCalledWith(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    expect(pollForToken).toHaveBeenCalledWith(
      "dc",
      5,
      900,
      ["chat:read"],
      undefined,
      expect.any(AbortSignal)
    );
    expect(closePopup).toHaveBeenCalledTimes(1);
    expect(token).toEqual(expect.objectContaining({ accessToken: "at", authFlow: "device-code" }));
  });

  it("keeps a completed authorization successful when popup close races with token completion", async () => {
    let reportClosed: () => void = () => undefined;
    const popupClosed = new Promise<void>((resolve) => {
      reportClosed = resolve;
    });
    let resolveToken: (token: { accessToken: string; authFlow: "device-code" }) => void = () =>
      undefined;
    const pollForToken = vi.fn(
      async () =>
        await new Promise<{ accessToken: string; authFlow: "device-code" }>((resolve) => {
          resolveToken = resolve;
        })
    );
    const login = runTwitchDeviceCodeLogin(["chat:read"], {
      requestDeviceCode: vi.fn(async () => ({
        deviceCode: "dc",
        userCode: "ABCD-EFGH",
        verificationUri: "https://www.twitch.tv/activate",
        expiresIn: 900,
        interval: 5,
      })),
      openVerificationWindow: vi.fn(async () => ({
        closed: popupClosed,
        close: vi.fn(),
      })),
      pollForToken,
    });
    await Promise.resolve();
    await Promise.resolve();

    resolveToken({ accessToken: "at", authFlow: "device-code" });
    reportClosed();

    await expect(login).resolves.toMatchObject({ accessToken: "at" });
  });

  // Guards: closing the Twitch popup must promptly settle login instead of leaving the poll Promise hanging.
  it("cancels token polling when the user closes the popup", async () => {
    let reportClosed: () => void = () => undefined;
    const popupClosed = new Promise<void>((resolve) => {
      reportClosed = resolve;
    });
    const pollForToken = vi.fn(
      async (
        _deviceCode: string,
        _interval: number,
        _expiresIn: number,
        _scopes: string[],
        _onStatusChange: unknown,
        signal?: AbortSignal
      ) =>
        await new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error("Authorization cancelled"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("Authorization cancelled")), {
            once: true,
          });
        })
    );

    const login = runTwitchDeviceCodeLogin(["chat:read"], {
      requestDeviceCode: vi.fn(async () => ({
        deviceCode: "dc",
        userCode: "ABCD-EFGH",
        verificationUri: "https://www.twitch.tv/activate",
        expiresIn: 900,
        interval: 5,
      })),
      openVerificationWindow: vi.fn(async () => ({
        closed: popupClosed,
        close: vi.fn(),
      })),
      pollForToken,
    });
    await Promise.resolve();

    reportClosed();

    await expect(login).rejects.toThrow("Authorization cancelled");
    const signal = pollForToken.mock.calls[0]?.[5];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });
});
