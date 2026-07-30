import { createBrowserElectronApi } from "./browser-electron-api";
import { createRelayRpcClient } from "./relay-rpc-client";
import { createDevRelayWebSocket, waitForRelaySocket } from "./websocket";

declare global {
  interface Window {
    __STREAMFUSION_BROWSER_DEV_CLIENT__?: boolean;
  }
}

async function boot(): Promise<void> {
  window.__STREAMFUSION_BROWSER_DEV_CLIENT__ = true;
  const socket = await waitForRelaySocket(() => createDevRelayWebSocket("browser"));
  Object.defineProperty(window, "electronAPI", {
    configurable: false,
    value: createBrowserElectronApi(createRelayRpcClient(socket)),
  });
  await import("../renderer");
}

void boot().catch((error) => {
  const root = document.getElementById("root");
  if (root) {
    root.textContent =
      error instanceof Error ? error.message : "Could not connect to the StreamFusion relay";
  }
});
