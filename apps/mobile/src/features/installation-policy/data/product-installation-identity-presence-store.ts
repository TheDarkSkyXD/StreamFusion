import type {
  InstallationIdentityPresenceStore,
  InstallationPolicySnapshotStore,
} from "../capabilities/installation-policy";

const serializedInitializedMarker = JSON.stringify({
  state: "initialized",
  version: 1,
});

export function createProductInstallationIdentityPresenceStore(
  store: InstallationPolicySnapshotStore,
  nowEpochMs: () => number,
): InstallationIdentityPresenceStore {
  return {
    async read() {
      const value = await store.read();
      if (value === null) return { kind: "absent" };
      return value === serializedInitializedMarker
        ? { kind: "initialized" }
        : { kind: "corrupt" };
    },
    async writeInitialized() {
      await store.write(serializedInitializedMarker, nowEpochMs());
      if ((await store.read()) !== serializedInitializedMarker) {
        throw new Error("Installation identity presence marker did not persist.");
      }
    },
  };
}
