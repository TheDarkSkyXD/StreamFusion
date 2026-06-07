/**
 * StreamFusion - Renderer Process Entry Point
 *
 * This file bootstraps the React application in the Electron renderer process.
 */

import { installConsoleIntercept } from "@/renderer/logging/console-intercept";
import { installNetworkMonitor } from "@/renderer/logging/network-monitor";
import { installRendererErrorHooks } from "@/renderer/logging/renderer-error-hooks";

installConsoleIntercept();
installRendererErrorHooks();
installNetworkMonitor();

import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

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

console.debug("🌩️ StreamFusion is running in renderer process");
