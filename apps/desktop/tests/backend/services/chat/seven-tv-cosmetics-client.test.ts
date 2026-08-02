import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseSevenTvCosmeticFrame,
  SevenTvCosmeticsClient,
} from "@/backend/services/chat/seven-tv-cosmetics-client";

// Guards: 7TV Event API badge definitions retain a stable provider-qualified identity so badges from different providers cannot collide.
describe("parseSevenTvCosmeticFrame", () => {
  it("parses a 7TV badge definition", () => {
    const events = parseSevenTvCosmeticFrame({
      op: 0,
      d: {
        type: "cosmetic.create",
        body: {
          object: {
            kind: "BADGE",
            data: {
              id: "badge-1",
              tooltip: "7TV Subscriber",
              host: {
                url: "//cdn.7tv.app/badge-1",
                files: [
                  { name: "1x.webp", format: "WEBP", width: 18, height: 18 },
                  { name: "4x.webp", format: "WEBP", width: 72, height: 72 },
                ],
              },
            },
          },
        },
      },
    });

    expect(events).toEqual([
      {
        type: "badge.upsert",
        badge: {
          id: "7tv:badge-1",
          provider: "7tv",
          providerId: "badge-1",
          title: "7TV Subscriber",
          imageUrl: "https://cdn.7tv.app/badge-1/4x.webp",
        },
      },
    ]);
  });

  it("parses a linear paint with RGBA stops, angle, repeat, and shadows", () => {
    const events = parseSevenTvCosmeticFrame({
      op: 0,
      d: {
        type: "cosmetic.create",
        body: {
          object: {
            kind: "PAINT",
            data: {
              id: "paint-1",
              name: "Sunset",
              function: "LINEAR_GRADIENT",
              angle: 45,
              repeat: true,
              stops: [
                { at: 0, color: 0xff000080 },
                { at: 1, color: 0x00ff00ff },
              ],
              shadows: [{ x_offset: 1, y_offset: 2, radius: 3, color: 0x0000ffff }],
            },
          },
        },
      },
    });

    expect(events).toEqual([
      {
        type: "paint.upsert",
        paint: {
          id: "paint-1",
          name: "Sunset",
          function: "linear-gradient",
          angle: 45,
          repeat: true,
          stops: [
            { at: 0, color: "rgba(255, 0, 0, 0.502)" },
            { at: 1, color: "rgba(0, 255, 0, 1)" },
          ],
          shadows: [{ xOffset: 1, yOffset: 2, radius: 3, color: "rgba(0, 0, 255, 1)" }],
        },
      },
    ]);
  });

  it("accepts lowercase radial paints and safely drops malformed stops", () => {
    const events = parseSevenTvCosmeticFrame({
      op: 0,
      d: {
        type: "cosmetic.create",
        body: {
          object: {
            kind: "PAINT",
            data: {
              id: "paint-radial",
              name: "Halo",
              function: "radial_gradient",
              shape: "circle",
              stops: [
                { at: 0.5, color: 0xffffffff },
                { at: "bad", color: null },
              ],
              shadows: [null],
            },
          },
        },
      },
    });

    expect(events).toEqual([
      {
        type: "paint.upsert",
        paint: {
          id: "paint-radial",
          name: "Halo",
          function: "radial-gradient",
          shape: "circle",
          stops: [{ at: 0.5, color: "rgba(255, 255, 255, 1)" }],
          shadows: [],
        },
      },
    ]);
  });

  it("parses URL paints without requiring gradient stops", () => {
    const events = parseSevenTvCosmeticFrame({
      op: 0,
      d: {
        type: "cosmetic.create",
        body: {
          object: {
            kind: "PAINT",
            data: {
              id: "paint-image",
              name: "Aurora",
              function: "url",
              image_url: "https://cdn.7tv.app/paint.webp",
              shadows: [],
            },
          },
        },
      },
    });

    expect(events).toEqual([
      {
        type: "paint.upsert",
        paint: {
          id: "paint-image",
          name: "Aurora",
          function: "url",
          imageUrl: "https://cdn.7tv.app/paint.webp",
          stops: [],
          shadows: [],
        },
      },
    ]);
  });

  it("maps a Twitch user to their selected 7TV paint", () => {
    const events = parseSevenTvCosmeticFrame({
      op: 0,
      d: {
        type: "entitlement.create",
        body: {
          object: {
            kind: "PAINT",
            ref_id: "paint-1",
            user: {
              connections: [
                { platform: "KICK", id: "kick-user" },
                { platform: "TWITCH", id: "twitch-user" },
              ],
              style: { paint_id: "paint-1" },
            },
          },
        },
      },
    });

    expect(events).toEqual([
      {
        type: "assignment.upsert",
        assignment: { userId: "twitch-user", kind: "paint", cosmeticId: "paint-1" },
      },
    ]);
  });

  it.each([
    ["entitlement.create", "assignment.upsert"],
    ["entitlement.delete", "assignment.delete"],
    ["entitlement.reset", "assignment.delete"],
  ] as const)("maps every unique Twitch connection for %s", (eventType, assignmentType) => {
    const events = parseSevenTvCosmeticFrame({
      op: 0,
      d: {
        type: eventType,
        body: {
          object: {
            kind: "BADGE",
            ref_id: "badge-1",
            user: {
              connections: [
                { platform: "TWITCH", id: "twitch-one" },
                { platform: "KICK", id: "kick-user" },
                { platform: "twitch", id: "twitch-two" },
                { platform: "TWITCH", id: "twitch-one" },
              ],
              style: { badge_id: "badge-1" },
            },
          },
        },
      },
    });

    expect(events).toEqual([
      {
        type: assignmentType,
        assignment: { userId: "twitch-one", kind: "badge", cosmeticId: "badge-1" },
      },
      {
        type: assignmentType,
        assignment: { userId: "twitch-two", kind: "badge", cosmeticId: "badge-1" },
      },
    ]);
  });

  it("parses entitlement deletion with the exact cosmetic identity to clear", () => {
    const events = parseSevenTvCosmeticFrame({
      op: 0,
      d: {
        type: "entitlement.delete",
        body: {
          object: {
            kind: "BADGE",
            ref_id: "badge-old",
            user: {
              connections: [{ platform: "TWITCH", id: "twitch-user" }],
              style: { badge_id: "badge-new" },
            },
          },
        },
      },
    });

    expect(events).toEqual([
      {
        type: "assignment.delete",
        assignment: { userId: "twitch-user", kind: "badge", cosmeticId: "badge-old" },
      },
    ]);
  });
});

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  closeCalls = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }
  send(value: string): void {
    this.sent.push(value);
  }
  close(): void {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }
  message(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
  error(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onerror?.({} as Event);
  }
  closeFromServer(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1006 } as CloseEvent);
  }
}

// Guards: every socket subscribes cosmetics and entitlements to the requested Twitch channel.
// Guards: heartbeat loss and socket errors reconnect with bounded delays instead of leaving cosmetics stale or entering a tight loop.
// Guards: retired sockets and explicit disconnects cannot create duplicate or zombie reconnects.
describe("SevenTvCosmeticsClient lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("subscribes channel-scoped wildcard events and does not reconnect after disconnect", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe("wss://events.7tv.io/v3");
    socket.open();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: 35,
        d: { type: "cosmetic.*", condition: { ctx: "channel", platform: "TWITCH", id: "12345" } },
      },
      {
        op: 35,
        d: {
          type: "entitlement.*",
          condition: { ctx: "channel", platform: "TWITCH", id: "12345" },
        },
      },
    ]);

    client.disconnect();
    expect(socket.closeCalls).toBe(1);
    socket.closeFromServer();
    await vi.runAllTimersAsync();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("reconnects after three missed server heartbeat intervals", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.message({ op: 1, d: { heartbeat_interval: 100 } });

    await vi.advanceTimersByTimeAsync(299);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.closeCalls).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
  });

  it("resets the liveness deadline when another server message arrives", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.message({ op: 1, d: { heartbeat_interval: 100 } });

    await vi.advanceTimersByTimeAsync(250);
    socket.message({ op: 2, d: {} });
    await vi.advanceTimersByTimeAsync(299);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
  });

  it("cancels an armed liveness deadline on explicit disconnect", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.message({ op: 1, d: { heartbeat_interval: 100 } });

    client.disconnect();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.closeCalls).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("clears the old liveness deadline when the server requests a reconnect", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.message({ op: 1, d: { heartbeat_interval: 100 } });

    await vi.advanceTimersByTimeAsync(100);
    socket.message({ op: 4, d: {} });
    expect(MockWebSocket.instances).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
  });

  it("retains delayed reconnect behavior after an unexpected close", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.closeFromServer();

    await vi.advanceTimersByTimeAsync(999);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
  });

  it("retries after an error even when the socket never emits close", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.message({ op: 1, d: { heartbeat_interval: 100 } });

    socket.error();
    await vi.advanceTimersByTimeAsync(999);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
  });

  it("schedules only one retry when close arrives after an error", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    const queuedClose = socket.onclose;

    socket.error();
    await vi.advanceTimersByTimeAsync(100);
    queuedClose?.({ code: 1006 } as CloseEvent);

    await vi.advanceTimersByTimeAsync(899);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
  });

  it("ignores an error queued by a superseded socket", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    const queuedError = socket.onerror;

    socket.message({ op: 4, d: {} });
    expect(MockWebSocket.instances).toHaveLength(2);
    queuedError?.({} as Event);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
  });

  it("cancels an error-triggered retry on explicit disconnect", async () => {
    const client = new SevenTvCosmeticsClient("12345", () => undefined);
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.error();
    await vi.advanceTimersByTimeAsync(500);
    client.disconnect();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
