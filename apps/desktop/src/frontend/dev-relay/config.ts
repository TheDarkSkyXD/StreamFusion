const RELAY_PATH = "/__streamfusion-dev";
const TOKEN_HEADER = "x-streamfusion-dev-token";

export interface BrowserDevelopmentConfig {
  enabled: boolean;
  browserEntry?: "browser.html";
  server?: {
    open: "/browser.html";
    proxy: Record<
      typeof RELAY_PATH,
      {
        target: string;
        ws: true;
        changeOrigin: false;
        headers: Record<typeof TOKEN_HEADER, string>;
      }
    >;
  };
}

interface BrowserDevelopmentConfigInput {
  command: "build" | "serve";
  mode: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function requireRelayPort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Browser development requires a valid local relay port");
  }
  return port;
}

export function createBrowserDevelopmentConfig({
  command,
  mode,
  env,
}: BrowserDevelopmentConfigInput): BrowserDevelopmentConfig {
  const enabled =
    command === "serve" && mode === "development" && env.STREAMFUSION_BROWSER_DEV === "1";
  if (!enabled) return { enabled: false };

  const relayPort = requireRelayPort(env.STREAMFUSION_DEV_RELAY_PORT);
  const relayToken = env.STREAMFUSION_DEV_RELAY_TOKEN;
  if (!relayToken) throw new Error("Browser development requires a per-run relay token");

  return {
    enabled: true,
    browserEntry: "browser.html",
    server: {
      open: "/browser.html",
      proxy: {
        [RELAY_PATH]: {
          target: `http://127.0.0.1:${relayPort}`,
          ws: true,
          changeOrigin: false,
          headers: { [TOKEN_HEADER]: relayToken },
        },
      },
    },
  };
}
