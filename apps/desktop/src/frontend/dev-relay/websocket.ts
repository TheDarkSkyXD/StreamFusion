import { sleep } from "@shared/utils/sleep";

export type DevRelayRole = "host" | "browser";

export interface RelayWebSocket {
  readonly readyState: number;
  addEventListener(
    type: "open" | "error",
    listener: () => void,
    options?: { once?: boolean }
  ): void;
  close?(): void;
}

interface RelayConnectionOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export function createDevRelayWebSocket(role: DevRelayRole): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL("/__streamfusion-dev", `${protocol}//${window.location.host}`);
  url.searchParams.set("role", role);
  return new WebSocket(url);
}

function waitForSocket(socket: RelayWebSocket): Promise<RelayWebSocket> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("Development relay unavailable")), {
      once: true,
    });
  });
}

export async function waitForRelaySocket<TSocket extends RelayWebSocket>(
  createSocket: () => TSocket,
  { maxAttempts = 60, retryDelayMs = 100, wait = sleep }: RelayConnectionOptions = {}
): Promise<TSocket> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const socket = createSocket();
    try {
      return (await waitForSocket(socket)) as TSocket;
    } catch (error) {
      socket.close?.();
      if (attempt === maxAttempts) throw error;
      await wait(retryDelayMs);
    }
  }
  throw new Error("Development relay unavailable");
}
