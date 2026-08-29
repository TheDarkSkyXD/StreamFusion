import { decodeRelayMessage, encodeRelayMessage, serializeRelayError } from "./protocol";
import type { RelaySocket } from "./relay-rpc-client";

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function resolveBridgeMethod(
  electronApi: object,
  path: readonly string[]
): (...args: unknown[]) => unknown {
  if (
    path.length === 0 ||
    path.length > 4 ||
    path.some((part) => FORBIDDEN_PATH_SEGMENTS.has(part))
  ) {
    throw new Error("Invalid Electron API relay path");
  }

  let owner = electronApi;
  for (const segment of path.slice(0, -1)) {
    const next = Reflect.get(owner, segment);
    if (!next || typeof next !== "object") throw new Error("Unknown Electron API relay path");
    owner = next;
  }
  const method = Reflect.get(owner, path.at(-1) as string);
  if (typeof method !== "function") throw new Error("Unknown Electron API relay method");
  return (...args) => Reflect.apply(method, owner, args);
}

export function startRelayHost(socket: RelaySocket, electronApi: object): () => void {
  const subscriptions = new Map<string, () => void>();

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const message = decodeRelayMessage(event.data);

    if (message.type === "unsubscribe") {
      subscriptions.get(message.id)?.();
      subscriptions.delete(message.id);
      return;
    }
    if (message.type === "subscribe") {
      try {
        const method = resolveBridgeMethod(electronApi, message.path);
        const cleanup = method(...message.args, (...args: unknown[]) => {
          socket.send(encodeRelayMessage({ type: "event", id: message.id, args }));
        });
        if (typeof cleanup !== "function") throw new Error("Relay method is not subscribable");
        subscriptions.set(message.id, () => cleanup());
      } catch (error) {
        socket.send(
          encodeRelayMessage({
            type: "result",
            id: message.id,
            ok: false,
            error: serializeRelayError(error),
          })
        );
      }
      return;
    }
    if (message.type !== "call") return;

    void Promise.resolve()
      .then(() => resolveBridgeMethod(electronApi, message.path)(...message.args))
      .then(
        (value) => {
          socket.send(encodeRelayMessage({ type: "result", id: message.id, ok: true, value }));
        },
        (error) => {
          socket.send(
            encodeRelayMessage({
              type: "result",
              id: message.id,
              ok: false,
              error: serializeRelayError(error),
            })
          );
        }
      );
  });

  return () => {
    for (const cleanup of subscriptions.values()) cleanup();
    subscriptions.clear();
  };
}
