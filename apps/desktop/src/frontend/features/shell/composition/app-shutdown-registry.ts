import { logger } from "@/renderer/logging/logger";
import { createShutdownRegistry } from "../domain/shutdown-registry";

export const { registerAppShutdownTask, runAppShutdownTasks } = createShutdownRegistry(
  (key, error) => {
      logger.warn("AppShutdown", "Renderer shutdown task failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
  }
);
