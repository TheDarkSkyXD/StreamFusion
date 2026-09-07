import type { SnapshotStorage } from "../capabilities/snapshot-storage";

export const desktopSnapshotStorage: SnapshotStorage = {
  get: (key) => window.electronAPI.store.get(key),
  set: (key, value) => window.electronAPI.store.set(key, value),
  delete: (key) => window.electronAPI.store.delete(key),
};
