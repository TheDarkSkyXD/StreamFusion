import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type DatabaseService = {
  initialize(): void;
};

type DatabaseServiceLifecycle = {
  db: { close(): void } | null;
};

export function createIsolatedDatabaseTestLifecycle(
  databaseService: DatabaseService,
  setUserDataPath: (directory: string) => void,
  directoryPrefix: string
) {
  let directory: string | null = null;

  return {
    initialize(): void {
      directory = mkdtempSync(path.join(tmpdir(), directoryPrefix));
      setUserDataPath(directory);

      try {
        databaseService.initialize();
      } catch (error) {
        this.dispose();
        throw error;
      }
    },

    dispose(): void {
      const lifecycle = databaseService as unknown as DatabaseServiceLifecycle;

      try {
        lifecycle.db?.close();
      } finally {
        lifecycle.db = null;
        if (directory) {
          rmSync(directory, { recursive: true, force: true });
          directory = null;
        }
      }
    },
  };
}
