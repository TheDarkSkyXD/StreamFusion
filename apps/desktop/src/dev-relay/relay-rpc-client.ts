import type { BrowserRelayClient } from "./browser-electron-api";
import { decodeRelayMessage, encodeRelayMessage } from "./protocol";

export interface RelaySocket {
  send(message: string): void;
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

let nextRelayId = 0;

function createRelayId(prefix: string): string {
  nextRelayId += 1;
  return `${prefix}-${nextRelayId}`;
}

export function createRelayRpcClient(socket: RelaySocket): BrowserRelayClient {
  const pending = new Map<string, PendingCall>();
  const subscriptions = new Map<string, (...eventArgs: unknown[]) => void>();

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const message = decodeRelayMessage(event.data);
    if (message.type === "result") {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.ok) {
        call.resolve(message.value);
      } else {
        const error = new Error(message.error.message);
        error.name = message.error.name;
        if (message.error.code) Object.assign(error, { code: message.error.code });
        call.reject(error);
      }
      return;
    }
    if (message.type === "event") subscriptions.get(message.id)?.(...message.args);
  });

  return {
    call(path, args) {
      const id = createRelayId("call");
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      socket.send(encodeRelayMessage({ type: "call", id, path: [...path], args: [...args] }));
      return result;
    },
    subscribe(path, args, listener) {
      const id = createRelayId("subscription");
      subscriptions.set(id, listener);
      socket.send(encodeRelayMessage({ type: "subscribe", id, path: [...path], args: [...args] }));
      return () => {
        if (!subscriptions.delete(id)) return;
        socket.send(encodeRelayMessage({ type: "unsubscribe", id }));
      };
    },
  };
}
