import type { SnapshotStorage } from "../capabilities/snapshot-storage";
import { desktopSnapshotStorage } from "../data/desktop-snapshot-storage";

export const snapshotStorage: SnapshotStorage = desktopSnapshotStorage;
