import path from "node:path";
import { pathToFileURL } from "node:url";

import { app } from "electron";

export function getMainRendererDocumentUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL;
  }
  return pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
}
