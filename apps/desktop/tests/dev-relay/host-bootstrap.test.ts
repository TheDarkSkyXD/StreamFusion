import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapDevRelayHost, startDevRelayHost } from "@/dev-relay/host-bootstrap";
import { encodeRelayMessage } from "@/dev-relay/protocol";

afterEach(() => vi.unstubAllGlobals());

// Guards: browser development starts a relay host only in Electron and exposes its shutdown.
// Guards: shutdown releases bridge subscriptions, closes the socket even when cleanup fails, and ignores pending replies.
describe("development relay host bootstrap", () => {
  it("starts only in the Electron renderer for browser development", async () => {
    let activeHosts = 0;
    const startHost = async () => {
      activeHosts += 1;
      return () => {
        activeHosts -= 1;
      };
    };

    const stopHost = await bootstrapDevRelayHost({
      enabled: true,
      isBrowserClient: false,
      startHost,
    });
    const stopBrowser = await bootstrapDevRelayHost({
      enabled: true,
      isBrowserClient: true,
      startHost,
    });
    const stopDisabled = await bootstrapDevRelayHost({
      enabled: false,
      isBrowserClient: false,
      startHost,
    });

    expect(activeHosts).toBe(1);
    stopBrowser();
    stopDisabled();
    expect(activeHosts).toBe(1);
    stopHost();
    expect(activeHosts).toBe(0);
  });

  it.each(["dispose", "close", "failed cleanup"])("releases the host on %s", async (action) => {
    const sockets: TestSocket[] = [];
    class TestSocket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      sent: string[] = [];
      closes = 0;
      constructor() {
        super();
        sockets.push(this);
      }
      send(message: string) {
        this.sent.push(message);
      }
      close() {
        this.closes += 1;
        this.dispatchEvent(new Event("close"));
      }
      receive(message: string) {
        this.dispatchEvent(new MessageEvent("message", { data: message }));
      }
    }
    let activeSubscriptions = 0;
    let calls = 0;
    const result = Promise.withResolvers<string>();
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost" },
      electronAPI: {
        downloads: {
          onQueueChanged() {
            activeSubscriptions += 1;
            return () => {
              activeSubscriptions -= 1;
              if (action === "failed cleanup") throw new Error("Subscription cleanup failed");
            };
          },
          async getQueue() {
            calls += 1;
            return result.promise;
          },
        },
      },
    });
    const stop = await startDevRelayHost();
    const socket = sockets[0];
    const subscription = encodeRelayMessage({
      type: "subscribe",
      id: "queue-events",
      path: ["downloads", "onQueueChanged"],
      args: [],
    });
    socket.receive(subscription);
    socket.receive(
      encodeRelayMessage({ type: "call", id: "queue", path: ["downloads", "getQueue"], args: [] })
    );
    await Promise.resolve();
    expect(activeSubscriptions).toBe(1);
    expect(calls).toBe(1);

    if (action === "failed cleanup") expect(stop).toThrow("Development relay cleanup failed");
    else if (action === "dispose") stop();
    else socket.dispatchEvent(new Event("close"));
    stop();
    socket.receive(subscription);
    result.resolve("finished");
    await result.promise;
    await Promise.resolve();
    expect(activeSubscriptions).toBe(0);
    expect(socket.closes).toBe(1);
    expect(socket.sent).toEqual([]);
  });
});
