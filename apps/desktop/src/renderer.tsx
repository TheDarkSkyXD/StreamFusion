/**
 * StreamFusion - Renderer Process Entry Point
 *
 * This file bootstraps the React application in the Electron renderer process.
 */

import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";
import { migrateLocalStorage } from "./lib/migrate-localstorage";

// Migrate old "streamstorm-*" localStorage keys to "streamfusion-*" (one-time, before stores init)
migrateLocalStorage();

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
