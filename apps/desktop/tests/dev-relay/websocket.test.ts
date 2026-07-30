import { describe, expect, it, vi } from "vitest";

import { type RelayWebSocket, waitForRelaySocket } from "@/dev-relay/websocket";

function socketThat(result: "open" | "error"): RelayWebSocket {
  return {
    readyState: WebSocket.CONNECTING,
    addEventListener(type, listener) {
      if (type === result) queueMicrotask(listener);
    },
  };
}

// Guards: opening the browser before Electron's development relay is listening must recover
// instead of leaving the browser harness permanently stuck on a connection error.
describe("development relay connection", () => {
  it("retries a transient connection failure and resolves the next open socket", async () => {
    const opened = socketThat("open");
    const createSocket = vi
      .fn<() => RelayWebSocket>()
      .mockReturnValueOnce(socketThat("error"))
      .mockReturnValueOnce(opened);
    const wait = vi.fn(async () => undefined);

    await expect(
      waitForRelaySocket(createSocket, {
        maxAttempts: 2,
        retryDelayMs: 25,
        wait,
      })
    ).resolves.toBe(opened);

    expect(createSocket).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });
});
