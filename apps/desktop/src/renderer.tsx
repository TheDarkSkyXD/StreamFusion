/**
 * StreamFusion - Renderer Process Entry Point
 *
 * This file bootstraps the React application in the Electron renderer process.
 */

import { applyModerationBrowserFixture } from "@/dev-relay/moderation-browser-fixtures";
import { installIntervalTracker } from "@/components/dev/interval-tracker";
import { installConsoleIntercept } from "@/renderer/logging/console-intercept";
import { installNetworkMonitor } from "@/renderer/logging/network-monitor";
import { installRendererErrorHooks } from "@/renderer/logging/renderer-error-hooks";

const performanceHarnessRequested =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("perf") === "1";
if (performanceHarnessRequested) performance.mark("streamfusion:renderer-module-enter");

installConsoleIntercept();
installRendererErrorHooks();
installNetworkMonitor();
installIntervalTracker();

if (import.meta.env.DEV) {
  applyModerationBrowserFixture(window.location.search);
}

if (import.meta.env.DEV && import.meta.env.VITE_STREAMFUSION_BROWSER_DEV === "1") {
  void import("@/dev-relay/host-bootstrap")
    .then(({ bootstrapDevRelayHost }) =>
      bootstrapDevRelayHost({
        enabled: true,
        isBrowserClient: Boolean(window.__STREAMFUSION_BROWSER_DEV_CLIENT__),
      })
    )
    .catch((error) => {
      console.error("Could not start the browser development relay host", error);
    });
}

import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./global.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element not found. Check index.html for div#root");
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (performanceHarnessRequested) {
  performance.mark("streamfusion:root-render-called");
  requestAnimationFrame(() => {
    performance.mark("streamfusion:first-render-frame");
    requestAnimationFrame(() => performance.mark("streamfusion:first-presented-frame"));
  });
  void import("@/renderer/performance/performance-harness").then(
    ({ installPerformanceHarness }) => {
      installPerformanceHarness();
    }
  );
}

console.debug("🌩️ StreamFusion is running in renderer process");
