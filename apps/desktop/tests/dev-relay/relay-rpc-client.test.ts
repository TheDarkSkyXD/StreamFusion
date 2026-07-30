import { describe, expect, it } from "vitest";
import { encodeRelayMessage } from "@/dev-relay/protocol";
import { createRelayRpcClient, type RelaySocket } from "@/dev-relay/relay-rpc-client";

class FakeRelaySocket implements RelaySocket {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: { data?: string }) => void>>();

  send(message: string): void {
    this.sent.push(message);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

// Guards: out-of-order browser relay responses resolve the request with the matching correlation id
describe("development relay RPC client", () => {
  it("correlates a successful result with its pending call", async () => {
    const socket = new FakeRelaySocket();
    const client = createRelayRpcClient(socket);
    const result = client.call(["streams", "getTop"], [{ platform: "kick" }]);
    const request = JSON.parse(socket.sent[0]) as { id: string };

    socket.emit("message", {
      data: encodeRelayMessage({
        type: "result",
        id: request.id,
        ok: true,
        value: { streams: ["live"] },
      }),
    });

    await expect(result).resolves.toEqual({ streams: ["live"] });
  });
});
