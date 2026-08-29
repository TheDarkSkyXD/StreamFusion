import { startRelayHost } from "./relay-host";
import { createDevRelayWebSocket, waitForRelaySocket } from "./websocket";

export async function startDevRelayHost(): Promise<void> {
  const socket = await waitForRelaySocket(() => createDevRelayWebSocket("host"));
  const stop = startRelayHost(socket, window.electronAPI);
  socket.addEventListener("close", stop, { once: true });
}

interface BootstrapDevRelayHostOptions {
  enabled: boolean;
  isBrowserClient: boolean;
  startHost?: () => Promise<void>;
}

export async function bootstrapDevRelayHost({
  enabled,
  isBrowserClient,
  startHost = startDevRelayHost,
}: BootstrapDevRelayHostOptions): Promise<void> {
  if (!enabled || isBrowserClient) return;
  await startHost();
}
