import { getRandomValues } from "expo-crypto";
import nacl from "tweetnacl";

const SEAL_PREFIX = "sf1:";
const keyPattern = /^[a-f0-9]{64}$/u;

export interface PayloadSecretBox {
  open(value: string): string;
  seal(plaintext: string): string;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function createPayloadSecretBox(keyHex: string): PayloadSecretBox {
  if (!keyPattern.test(keyHex)) {
    throw new Error("The payload encryption key is invalid.");
  }
  const key = hexToBytes(keyHex);
  return {
    seal(plaintext) {
      const nonce = new Uint8Array(nacl.secretbox.nonceLength);
      getRandomValues(nonce);
      const message = new TextEncoder().encode(plaintext);
      const boxed = nacl.secretbox(message, nonce, key);
      if (!boxed) throw new Error("Payload encryption failed.");
      const packed = new Uint8Array(nonce.length + boxed.length);
      packed.set(nonce, 0);
      packed.set(boxed, nonce.length);
      return `${SEAL_PREFIX}${bytesToBase64(packed)}`;
    },
    open(value) {
      if (!value.startsWith(SEAL_PREFIX)) return value;
      const packed = base64ToBytes(value.slice(SEAL_PREFIX.length));
      if (packed.length <= nacl.secretbox.nonceLength) {
        throw new Error("Sealed payload is truncated.");
      }
      const nonce = packed.slice(0, nacl.secretbox.nonceLength);
      const boxed = packed.slice(nacl.secretbox.nonceLength);
      const opened = nacl.secretbox.open(boxed, nonce, key);
      if (!opened) throw new Error("Sealed payload could not be decrypted.");
      return new TextDecoder().decode(opened);
    },
  };
}
