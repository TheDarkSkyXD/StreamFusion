import { describe, expect, it, vi } from "vitest";
import { decodeRelayMessage, encodeRelayMessage } from "@/dev-relay/protocol";
import { startRelayHost } from "@/dev-relay/relay-host";
import type { RelaySocket } from "@/dev-relay/relay-rpc-client";

class FakeRelaySocket implements RelaySocket {
  readonly sent: string[] = [];
  private listener?: (event: { data?: string }) => void;

  send(message: string): void {
    this.sent.push(message);
  }

  addEventListener(_type: string, listener: (event: { data?: string }) => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: string, listener: (event: { data?: string }) => void): void {
    if (this.listener === listener) this.listener = undefined;
  }

  receive(message: string): void {
    this.listener?.({ data: message });
  }
}

// Guards: Electron host executes only the requested public bridge method and returns its result
// Guards: unsubscribing in the browser releases the corresponding Electron IPC listener
// Guards: a failing subscription cleanup does not leave other subscriptions or listeners active.
// Guards: browser reloads that reuse subscription IDs replace their prior IPC listeners.
describe("development relay host", () => {
  it("dispatches a browser call through the real Electron API surface", async () => {
    const socket = new FakeRelaySocket();
    const getTop = vi.fn(async () => ({ streams: ["live"] }));
    startRelayHost(socket, { streams: { getTop } });

    socket.receive(
      encodeRelayMessage({
        type: "call",
        id: "call-1",
        path: ["streams", "getTop"],
        args: [{ platform: "twitch" }],
      })
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));

    expect(getTop).toHaveBeenCalledWith({ platform: "twitch" });
    expect(decodeRelayMessage(socket.sent[0])).toEqual({
      type: "result",
      id: "call-1",
      ok: true,
      value: { streams: ["live"] },
    });
  });

  it("disposes the host subscription when the browser unsubscribes", () => {
    const socket = new FakeRelaySocket();
    const cleanup = vi.fn();
    const onQueueChanged = vi.fn(() => cleanup);
    startRelayHost(socket, { downloads: { onQueueChanged } });

    socket.receive(
      encodeRelayMessage({
        type: "subscribe",
        id: "subscription-1",
        path: ["downloads", "onQueueChanged"],
        args: [],
      })
    );
    socket.receive(encodeRelayMessage({ type: "unsubscribe", id: "subscription-1" }));

    expect(onQueueChanged).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("releases every subscription when one cleanup fails", () => {
    const socket = new FakeRelaySocket();
    const active = new Set<string>();
    const stop = startRelayHost(socket, {
      events: {
        subscribe(id: string) {
          active.add(id);
          return () => {
            active.delete(id);
            if (id === "first") throw new Error("Could not finish first cleanup");
          };
        },
      },
    });
    const subscribe = (id: string) =>
      socket.receive(
        encodeRelayMessage({ type: "subscribe", id, path: ["events", "subscribe"], args: [id] })
      );
    subscribe("first");
    subscribe("second");
    expect([...active]).toEqual(["first", "second"]);
    expect(stop).toThrow("Development relay cleanup failed");
    subscribe("third");
    expect([...active]).toEqual([]);
    stop();
  });

  it("replaces an existing subscription when a browser reuses its ID", () => {
    const socket = new FakeRelaySocket();
    const active = new Set<number>();
    let generation = 0;
    const stop = startRelayHost(socket, {
      events: {
        subscribe() {
          const id = ++generation;
          active.add(id);
          return () => active.delete(id);
        },
      },
    });
    const message = encodeRelayMessage({
      type: "subscribe",
      id: "subscription-1",
      path: ["events", "subscribe"],
      args: [],
    });
    socket.receive(message);
    expect([...active]).toEqual([1]);
    socket.receive(message);
    expect([...active]).toEqual([2]);
    stop();
    expect([...active]).toEqual([]);
  });
});
