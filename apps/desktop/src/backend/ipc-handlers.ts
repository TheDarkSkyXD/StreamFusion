import type { BrowserWindow } from "electron";

import { logger } from "@backend/logging/logger";
import { runLoadedFeatureCleanups } from "@backend/startup/loaded-feature-cleanup";
import { registerLazyIpcFeatureLoader } from "./ipc/lazy-feature-loader";
import { MainRendererPortController, type MainRendererPort } from "./ipc/main-renderer-port";
import { TrustedIpcRegistry } from "./ipc/trusted-ipc-registry";

export interface DesktopIpcRuntime {
  readonly renderer: MainRendererPort;
  start(): void;
  bindWindow(window: BrowserWindow): void;
  dispose(): Promise<void>;
}

export function createDesktopIpcRuntime(): DesktopIpcRuntime {
  const renderer = new MainRendererPortController();
  const registry = new TrustedIpcRegistry(renderer);
  let started = false;
  let disposed = false;

  return {
    renderer,
    start(): void {
      if (started) return;
      if (disposed) throw new Error("Cannot start a disposed IPC runtime");
      try {
        registerLazyIpcFeatureLoader(renderer, registry);
        started = true;
        logger.debug("IPC:Bootstrap", "Core IPC handlers registered");
      } catch (error) {
        logger.error("IPC:Bootstrap", "Failed to register IPC handler group", {
          group: "feature-loader",
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: String(error) },
        });
      }
    },
    bindWindow(window): void {
      if (disposed) throw new Error("Cannot bind a disposed IPC runtime");
      renderer.bind(window);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      renderer.dispose();
      await runLoadedFeatureCleanups();
    },
  };
}
