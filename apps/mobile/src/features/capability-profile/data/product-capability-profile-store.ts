import type { CapabilityProfileSnapshotStore } from "@mobile/features/storage/capabilities/persistence";

import type { CapabilityProfileStore } from "../capabilities/capability-profile";

export function createProductCapabilityProfileStore(
  store: CapabilityProfileSnapshotStore,
): CapabilityProfileStore {
  return {
    read: () => store.read(),
    write: (serializedProfile, observedAtEpochMs) =>
      store.write(serializedProfile, observedAtEpochMs),
  };
}
