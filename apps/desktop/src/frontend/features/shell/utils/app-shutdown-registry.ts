import { logger } from "@/renderer/logging/logger";

export type AppShutdownTask = () => void | Promise<void>;

const shutdownTasks = new Map<string, AppShutdownTask>();

export function registerAppShutdownTask(key: string, task: AppShutdownTask): () => void {
  shutdownTasks.set(key, task);

  return () => {
    if (shutdownTasks.get(key) === task) shutdownTasks.delete(key);
  };
}

export function runAppShutdownTasks(): void {
  for (const [key, task] of shutdownTasks) {
    try {
      void Promise.resolve(task()).catch((error: unknown) => {
        logger.warn("AppShutdown", "Renderer shutdown task failed", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } catch (error) {
      logger.warn("AppShutdown", "Renderer shutdown task failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
