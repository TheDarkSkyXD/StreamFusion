import { startRendererRuntime } from "./renderer/runtime";
import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./i18n";
import "./global.css";

const runtime = startRendererRuntime();

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

runtime.markRenderCalled();
