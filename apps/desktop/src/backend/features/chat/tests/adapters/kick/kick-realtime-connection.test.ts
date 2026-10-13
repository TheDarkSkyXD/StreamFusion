import { describe, expect, it, vi } from "vitest";
import { net } from "electron";

vi.mock("electron", () => ({ net: { fetch: vi.fn() } }));

import { getKickRealtimeConnection } from "../../../adapters/kick/kick-realtime-connection";

describe("getKickRealtimeConnection", () => {
  it("negotiates fresh public Pusher credentials on every call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              mode: "websocket",
              connections: [
                { provider: "pusher", credentials: { app_key: "firstkey", cluster: "us2" } },
              ],
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              mode: "websocket",
              connections: [
                { provider: "pusher", credentials: { app_key: "rotatedkey", cluster: "eu" } },
              ],
            },
          }),
          { status: 200 }
        )
      );
    vi.mocked(net.fetch).mockImplementation(fetchMock);

    await expect(getKickRealtimeConnection()).resolves.toEqual({
      appKey: "firstkey",
      cluster: "us2",
    });
    await expect(getKickRealtimeConnection()).resolves.toEqual({
      appKey: "rotatedkey",
      cluster: "eu",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe("https://web.kick.com/api/v1/realtime/connection");
      expect(options.method).toBe("POST");
      expect(options.cache).toBe("no-store");
      expect(options.credentials).toBe("omit");
      expect(options.headers).toMatchObject({
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://kick.com",
        Referer: "https://kick.com/",
      });
      const body: unknown = JSON.parse(options.body);
      expect(body).toEqual({
        client: { id: expect.any(String), type: "web" },
        capabilities: { accepted_providers: [{ provider: "pusher" }] },
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("rejects a failed negotiation", async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(getKickRealtimeConnection()).rejects.toThrow(
      "Kick realtime negotiation failed (503)"
    );
  });

  it.each([
    {
      data: {
        mode: "polling",
        connections: [{ provider: "pusher", credentials: { app_key: "key", cluster: "us2" } }],
      },
    },
    {
      data: {
        mode: "websocket",
        connections: [{ provider: "other", credentials: { app_key: "key", cluster: "us2" } }],
      },
    },
    {
      data: {
        mode: "websocket",
        connections: [{ provider: "pusher", credentials: { app_key: "", cluster: "us2" } }],
      },
    },
    {
      data: {
        mode: "websocket",
        connections: [
          { provider: "pusher", credentials: { app_key: "key", cluster: "bad/cluster" } },
        ],
      },
    },
  ])("rejects an unusable connection descriptor", async (payload) => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    await expect(getKickRealtimeConnection()).rejects.toThrow("Kick realtime response is invalid");
  });
});
