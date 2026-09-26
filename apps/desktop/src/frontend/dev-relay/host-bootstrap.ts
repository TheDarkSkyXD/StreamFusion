import { startRelayHost } from "./relay-host";
import { createDevRelayWebSocket, waitForRelaySocket } from "./websocket";

export async function startDevRelayHost(): Promise<() => void> {
  const socket = await waitForRelaySocket(() => createDevRelayWebSocket("host"));
  const stopHost = startRelayHost(socket, window.electronAPI);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    socket.removeEventListener("close", stop);
    try {
      stopHost();
    } finally {
      socket.close();
    }
  };
  socket.addEventListener("close", stop, { once: true });
  return stop;
}

interface BootstrapDevRelayHostOptions {
  enabled: boolean;
  isBrowserClient: boolean;
  startHost?: () => Promise<() => void>;
}

export async function bootstrapDevRelayHost({
  enabled,
  isBrowserClient,
  startHost = startDevRelayHost,
}: BootstrapDevRelayHostOptions): Promise<() => void> {
  if (!enabled || isBrowserClient) return () => undefined;
  return startHost();
}
