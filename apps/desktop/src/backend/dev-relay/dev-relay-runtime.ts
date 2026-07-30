import type { DevMediaFetch } from "./dev-media-proxy";
import { type DevRelayServer, startDevRelayServer } from "./dev-relay-server";

export type { DevRelayServer };

interface StartConfiguredDevRelayOptions {
  isPackaged: boolean;
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>;
  rendererUrl: string | undefined;
  fetchMedia: DevMediaFetch;
  startServer?: typeof startDevRelayServer;
}

function parseRelayPort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Browser development relay port is invalid");
  }
  return port;
}

export async function startConfiguredDevRelay({
  isPackaged,
  environment,
  rendererUrl,
  fetchMedia,
  startServer = startDevRelayServer,
}: StartConfiguredDevRelayOptions): Promise<DevRelayServer | null> {
  if (isPackaged || environment.STREAMFUSION_BROWSER_DEV !== "1") return null;

  const token = environment.STREAMFUSION_DEV_RELAY_TOKEN;
  if (!token) throw new Error("Browser development relay token is missing");
  if (!rendererUrl) throw new Error("Browser development renderer URL is missing");

  return startServer({
    fetchMedia,
    port: parseRelayPort(environment.STREAMFUSION_DEV_RELAY_PORT),
    token,
    origin: new URL(rendererUrl).origin,
  });
}
