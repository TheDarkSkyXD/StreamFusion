import { logger } from "@shared/utils/cross-logger";
import { safeStorage } from "electron";
import Store from "electron-store";
import {
  assertRendererStoreKey,
  migrateLegacyStore,
  rendererStoreKey,
} from "../features/settings/data/legacy-store-migration";
import {
  defaults,
  type ElectronStoreSchema,
} from "../features/settings/data/persistent-store-schema";
import { dbService } from "./database-service";

export class StorageService {
  private store: Store<ElectronStoreSchema> | null = null;
  private isEncryptionAvailable = false;
  get encryptionAvailable(): boolean {
    return this.isEncryptionAvailable;
  }
  getStore(): Store<ElectronStoreSchema> {
    return this.storeInstance;
  }
  initialize() {
    if (this.store) return; // Already initialized

    try {
      this.store = new Store<ElectronStoreSchema>({
        // projectName must be passed explicitly even in electron-store@11. Conf
        // (the underlying lib) errors out when it can't derive a project name
        // from app.getName(), and during electron-vite dev startup the app
        // name isn't always populated before the module-level Store
        // instantiations fire (see update-service top-level call). The
        // commit-65b7a80 cleanup that dropped this field caused a hard crash
        // at "Please specify the projectName option" during dev rebuild.
        projectName: "streamfusion",
        name: "streamfusion-storage",
        defaults,
      } as ConstructorParameters<typeof Store<ElectronStoreSchema>>[0]);

      migrateLegacyStore(this.storeInstance);

      // Check if safeStorage encryption is available
      this.isEncryptionAvailable = safeStorage.isEncryptionAvailable();
      logger.debug("Service:Storage", "Storage service initialized", {
        encryptionAvailable: this.isEncryptionAvailable,
      });
    } catch (error) {
      this.store = null;
      throw error;
    }
  }

  private get storeInstance(): Store<ElectronStoreSchema> {
    if (!this.store) {
      throw new Error("Storage not initialized. Call initialize() first.");
    }
    return this.store;
  }

  // ========== Generic Renderer Storage (SQLite) ==========

  /**
   * Get a value from storage
   */
  get(key: string): unknown {
    assertRendererStoreKey(key);
    const result = dbService.getJson(rendererStoreKey(key));
    return result.kind === "value" ? result.value : undefined;
  }

  /**
   * Set a value in storage
   */
  set(key: string, value: unknown): void {
    assertRendererStoreKey(key);
    dbService.set(rendererStoreKey(key), value);
  }

  /**
   * Delete a value from storage
   */
  delete(key: string): void {
    assertRendererStoreKey(key);
    dbService.delete(rendererStoreKey(key));
  }

  /**
   * Get storage file path (for debugging)
   */
  getStorePath(): string {
    return this.storeInstance.path;
  }
}

export const storageService = new StorageService();
