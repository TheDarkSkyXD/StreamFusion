import { requireStorageModule } from "../../../../modules/streamfusion-native-contracts/src/storage";

import type { SecureSecretStore } from "@mobile/features/storage/capabilities/persistence";

export function createAndroidSecureSecretStore(): SecureSecretStore {
  return {
    delete(key) {
      return requireStorageModule().secretDelete(key);
    },
    get(key) {
      return requireStorageModule().secretGet(key);
    },
    isAvailable() {
      return requireStorageModule().secretIsAvailable();
    },
    set(key, value) {
      return requireStorageModule().secretSet(key, value);
    },
  };
}
