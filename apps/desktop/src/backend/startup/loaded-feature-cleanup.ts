import { logger } from "@backend/logging/logger";
import { registerFeatureRollback } from "@backend/ipc/feature-registration-transaction";

export type LoadedFeatureCleanup = () => void | Promise<void>;

const cleanups = new Map<string, LoadedFeatureCleanup>();

export function registerLoadedFeatureCleanup(key: string, cleanup: LoadedFeatureCleanup): void {
  const previous = cleanups.get(key);
  cleanups.set(key, cleanup);
  registerFeatureRollback(async () => {
    if (previous) cleanups.set(key, previous);
    else cleanups.delete(key);
    await cleanup();
  });
}

export async function runLoadedFeatureCleanups(): Promise<void> {
  const registeredCleanups = [...cleanups.entries()];
  cleanups.clear();

  await Promise.allSettled(
    registeredCleanups.map(async ([key, cleanup]) => {
      try {
        await cleanup();
      } catch (error) {
        logger.warn("FeatureCleanup", "Loaded feature cleanup failed", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );
}
