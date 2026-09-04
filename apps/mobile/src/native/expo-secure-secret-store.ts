import * as SecureStore from "expo-secure-store";

import type { SecureSecretStore } from "@mobile/capabilities/persistence";

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  keychainService: "streamfusion.mobile.secrets",
};

export function createExpoSecureSecretStore(): SecureSecretStore {
  return {
    delete(key) {
      return SecureStore.deleteItemAsync(key, options);
    },
    get(key) {
      return SecureStore.getItemAsync(key, options);
    },
    isAvailable() {
      return SecureStore.isAvailableAsync();
    },
    set(key, value) {
      return SecureStore.setItemAsync(key, value, options);
    },
  };
}
