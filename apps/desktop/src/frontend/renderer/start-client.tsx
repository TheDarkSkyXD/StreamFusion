import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { startRendererRuntime } from "./runtime";

async function boot() {
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("streamfusion-browser-dev") === "1"
  ) {
    const [
      { createBrowserElectronApi },
      { createRelayRpcClient },
      { createDevRelayWebSocket, waitForRelaySocket },
    ] = await Promise.all([
      import("../dev-relay/browser-electron-api"),
      import("../dev-relay/relay-rpc-client"),
      import("../dev-relay/websocket"),
    ]);
    window.__STREAMFUSION_BROWSER_DEV_CLIENT__ = true;
    const socket = await waitForRelaySocket(() => createDevRelayWebSocket("browser"));
    Object.defineProperty(window, "electronAPI", {
      value: createBrowserElectronApi(createRelayRpcClient(socket)),
    });
    import.meta.hot?.dispose(() => socket.close());
  }
  const runtime = startRendererRuntime();

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>
    );
    runtime.markRenderCalled();
  });
}

void boot().catch((error: unknown) => {
  console.error("Could not start StreamFusion", error);
  const root = document.getElementById("root");
  if (root)
    root.textContent = error instanceof Error ? error.message : "Could not start StreamFusion";
});
