import { requireStorageModule } from "../../../../modules/streamfusion-native-contracts/src/storage";

import type { SecureRandomSource } from "@mobile/features/storage/capabilities/persistence";

export function createAndroidSecureRandomSource(): SecureRandomSource {
  return {
    async databaseKey() {
      return requireStorageModule().randomBytes(32);
    },
    uuid() {
      return requireStorageModule().randomUuid().replaceAll("-", "");
    },
  };
}
