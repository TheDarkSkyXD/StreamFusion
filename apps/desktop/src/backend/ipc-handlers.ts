/**
 * Main-process IPC composition root.
 *
 * The feature-loader transport is the only eager entry point. Every handler
 * implementation registers after preload requests its feature chunk.
 */

import type { BrowserWindow } from "electron";

import { logger } from "@/backend/logging/logger";
import { registerLazyIpcFeatureLoader } from "./ipc/lazy-feature-loader";
import { TrustedIpcRegistry } from "./ipc/trusted-ipc-registry";

function registerIpcHandlerGroup(group: string, registrar: () => void): void {
  try {
    registrar();
  } catch (error) {
    logger.error("IPC:Bootstrap", "Failed to register IPC handler group", {
      group,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
    });
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const registry = new TrustedIpcRegistry(mainWindow);
  registerIpcHandlerGroup("feature-loader", () =>
    registerLazyIpcFeatureLoader(mainWindow, registry)
  );

  logger.debug("IPC:Bootstrap", "Core IPC handlers registered");
}
