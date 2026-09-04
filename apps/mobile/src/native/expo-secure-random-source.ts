import * as Crypto from "expo-crypto";

import type { SecureRandomSource } from "@mobile/capabilities/persistence";

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function createExpoSecureRandomSource(): SecureRandomSource {
  return {
    async databaseKey() {
      return bytesToHex(await Crypto.getRandomBytesAsync(32));
    },
    uuid() {
      return Crypto.randomUUID().replaceAll("-", "");
    },
  };
}
