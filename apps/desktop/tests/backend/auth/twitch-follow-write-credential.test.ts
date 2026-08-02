import { describe, expect, it, vi } from "vitest";

import {
  TWITCH_FOLLOW_WRITE_CLIENT_ID,
  TwitchFollowWriteCredentialService,
} from "@/backend/auth/twitch-follow-write-credential";

const XTRA_SCOPES =
  "channel_read chat:read user_blocks_edit user_blocks_read user_follows_edit user_read";

function pendingPromise(): Promise<void> {
  return new Promise(() => undefined);
}

// Guards: Twitch follow writes must authorize the Switch/Xtra client through the standard
// activation page, without exposing its device code through renderer IPC or logs.
describe("Twitch follow-write credential", () => {
  it("prefills Twitch activation and polls until the device credential is authorized", async () => {
    const storage = { get: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
    const activationWindow = { closed: pendingPromise(), close: vi.fn() };
    const openActivationWindow = vi.fn(
      (_verificationUri: string, _userCode: string) => activationWindow
    );
    const delay = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "device-1",
            user_code: "ABCD1234",
            verification_uri: "https://www.twitch.tv/activate",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 400, message: "authorization_pending" }), {
          status: 400,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "xtra-device-token",
            expires_in: 3600,
            scope: XTRA_SCOPES.split(" "),
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: TWITCH_FOLLOW_WRITE_CLIENT_ID,
            scopes: ["user_follows_edit"],
          }),
          { status: 200 }
        )
      );
    const service = new TwitchFollowWriteCredentialService({
      storage,
      fetch: fetchMock,
      openActivationWindow,
      delay,
    });

    await expect(service.getCredential()).resolves.toEqual({
      clientId: TWITCH_FOLLOW_WRITE_CLIENT_ID,
      accessToken: "xtra-device-token",
    });
    expect(openActivationWindow).toHaveBeenCalledWith(
      "https://www.twitch.tv/activate",
      "ABCD1234"
    );
    expect(delay).toHaveBeenCalledWith(1_000);
    expect(activationWindow.close).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "xtra-device-token" })
    );

    const fetchCalls = fetchMock.mock.calls as unknown as Array<[
      string | URL | Request,
      RequestInit?,
    ]>;
    const deviceBody = String(fetchCalls[0][1]?.body);
    expect(deviceBody).toContain(
      "scopes=channel_read+chat%3Aread+user_blocks_edit+user_blocks_read+user_follows_edit+user_read"
    );
    const tokenBody = new URLSearchParams(String(fetchCalls[1][1]?.body));
    expect(tokenBody.get("device_code")).toBe("device-1");
    expect(tokenBody.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code"
    );
  });

  it("shares one activation window across concurrent follow clicks", async () => {
    let releaseDeviceRequest: (response: Response) => void = () => undefined;
    const deviceRequest = new Promise<Response>((resolve) => {
      releaseDeviceRequest = resolve;
    });
    const storage = { get: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
    const openActivationWindow = vi.fn(() => ({ closed: pendingPromise(), close: vi.fn() }));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => deviceRequest)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "shared-token",
            expires_in: 3600,
            scope: ["user_follows_edit"],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: TWITCH_FOLLOW_WRITE_CLIENT_ID,
            scopes: ["user_follows_edit"],
          }),
          { status: 200 }
        )
      );
    const service = new TwitchFollowWriteCredentialService({
      storage,
      fetch: fetchMock,
      openActivationWindow,
    });

    const firstClick = service.getCredential();
    const secondClick = service.getCredential();
    releaseDeviceRequest(
      new Response(
        JSON.stringify({
          device_code: "shared-device",
          user_code: "SHARED12",
          verification_uri: "https://www.twitch.tv/activate",
          expires_in: 600,
          interval: 1,
        }),
        { status: 200 }
      )
    );

    await expect(Promise.all([firstClick, secondClick])).resolves.toEqual([
      { clientId: TWITCH_FOLLOW_WRITE_CLIENT_ID, accessToken: "shared-token" },
      { clientId: TWITCH_FOLLOW_WRITE_CLIENT_ID, accessToken: "shared-token" },
    ]);
    expect(openActivationWindow).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledOnce();
  });

  it("cancels polling when the activation window closes", async () => {
    let closeWindow: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      closeWindow = resolve;
    });
    const storage = { get: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "cancelled-device",
            user_code: "CANCEL12",
            verification_uri: "https://www.twitch.tv/activate",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "authorization_pending" }), { status: 400 })
      );
    const service = new TwitchFollowWriteCredentialService({
      storage,
      fetch: fetchMock,
      openActivationWindow: vi.fn(() => ({ closed, close: vi.fn() })),
      delay: vi.fn(() => {
        closeWindow();
        return pendingPromise();
      }),
    });

    await expect(service.getCredential()).rejects.toThrow(
      "Twitch follow authorization was cancelled"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("surfaces terminal device errors from Twitch's message envelope", async () => {
    const storage = { get: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "denied-device",
            user_code: "DENIED12",
            verification_uri: "https://www.twitch.tv/activate",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 400, message: "access_denied" }), { status: 400 })
      );
    const service = new TwitchFollowWriteCredentialService({
      storage,
      fetch: fetchMock,
      openActivationWindow: vi.fn(() => ({ closed: pendingPromise(), close: vi.fn() })),
    });

    await expect(service.getCredential()).rejects.toThrow("access_denied");
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("honors slow_down from Twitch's error envelope", async () => {
    const storage = { get: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
    const delay = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "slow-device",
            user_code: "SLOW1234",
            verification_uri: "https://www.twitch.tv/activate",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "slow_down" }), { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "token-after-slow-down",
            expires_in: 3600,
            scope: ["user_follows_edit"],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: TWITCH_FOLLOW_WRITE_CLIENT_ID,
            scopes: ["user_follows_edit"],
          }),
          { status: 200 }
        )
      );
    const service = new TwitchFollowWriteCredentialService({
      storage,
      fetch: fetchMock,
      openActivationWindow: vi.fn(() => ({ closed: pendingPromise(), close: vi.fn() })),
      delay,
    });

    await expect(service.getCredential()).resolves.toEqual({
      clientId: TWITCH_FOLLOW_WRITE_CLIENT_ID,
      accessToken: "token-after-slow-down",
    });
    expect(delay).toHaveBeenCalledWith(6_000);
  });

  it("stops polling when Twitch's device code expires", async () => {
    let now = 0;
    const storage = { get: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: "expired-device",
            user_code: "EXPIRE12",
            verification_uri: "https://www.twitch.tv/activate",
            expires_in: 1,
            interval: 1,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "authorization_pending" }), { status: 400 })
      );
    const service = new TwitchFollowWriteCredentialService({
      storage,
      fetch: fetchMock,
      openActivationWindow: vi.fn(() => ({ closed: pendingPromise(), close: vi.fn() })),
      delay: vi.fn(async (milliseconds) => {
        now += milliseconds;
      }),
      now: () => now,
    });

    await expect(service.getCredential()).rejects.toThrow("Twitch follow authorization expired");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storage.save).not.toHaveBeenCalled();
  });
});
