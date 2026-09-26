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

type RelayHostSocket = RelaySocket & {
  removeEventListener: RelaySocket["addEventListener"];
};

export function startRelayHost(socket: RelayHostSocket, electronApi: object): () => void {
  const subscriptions = new Map<string, () => void>();
  let stopped = false;

  const onMessage = (event: { data?: string }) => {
    if (stopped || typeof event.data !== "string") return;
    const message = decodeRelayMessage(event.data);

    if (message.type === "unsubscribe") {
      subscriptions.get(message.id)?.();
      subscriptions.delete(message.id);
      return;
    }
    if (message.type === "subscribe") {
      try {
        const previous = subscriptions.get(message.id);
        subscriptions.delete(message.id);
        previous?.();
        const method = resolveBridgeMethod(electronApi, message.path);
        const cleanup = method(...message.args, (...args: unknown[]) => {
          if (stopped) return;
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
      .then(() => {
        if (!stopped) return resolveBridgeMethod(electronApi, message.path)(...message.args);
      })
      .then(
        (value) => {
          if (stopped) return;
          socket.send(encodeRelayMessage({ type: "result", id: message.id, ok: true, value }));
        },
        (error) => {
          if (stopped) return;
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
  };
  socket.addEventListener("message", onMessage);

  return () => {
    if (stopped) return;
    stopped = true;
    socket.removeEventListener("message", onMessage);
    const cleanups = [...subscriptions.values()];
    subscriptions.clear();
    const errors: unknown[] = [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Development relay cleanup failed");
  };
}
