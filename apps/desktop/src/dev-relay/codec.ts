type RelayScalar = string | number | boolean | null;

type TaggedRelayValue =
  | { readonly $relay: "undefined" }
  | { readonly $relay: "date"; readonly value: string }
  | { readonly $relay: "map"; readonly value: ReadonlyArray<readonly [RelayValue, RelayValue]> }
  | { readonly $relay: "set"; readonly value: ReadonlyArray<RelayValue> }
  | { readonly $relay: "array-buffer"; readonly value: string };

export type RelayValue =
  | RelayScalar
  | TaggedRelayValue
  | ReadonlyArray<RelayValue>
  | { readonly [key: string]: RelayValue };

function isTaggedRelayValue(value: object): value is TaggedRelayValue {
  if (!("$relay" in value)) return false;
  return ["undefined", "date", "map", "set", "array-buffer"].includes(String(value.$relay));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
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

export function encodeRelayValue(value: unknown): RelayValue {
  if (value === undefined) return { $relay: "undefined" };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (value instanceof Date) return { $relay: "date", value: value.toISOString() };
  if (value instanceof Map) {
    return {
      $relay: "map",
      value: Array.from(value, ([key, item]) => [encodeRelayValue(key), encodeRelayValue(item)]),
    };
  }
  if (value instanceof Set) {
    return { $relay: "set", value: Array.from(value, encodeRelayValue) };
  }
  if (value instanceof ArrayBuffer) {
    return { $relay: "array-buffer", value: bytesToBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { $relay: "array-buffer", value: bytesToBase64(bytes) };
  }
  if (Array.isArray(value)) return value.map(encodeRelayValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        encodeRelayValue(item),
      ])
    );
  }
  throw new TypeError(`Unsupported relay value: ${typeof value}`);
}

export function decodeRelayValue(value: RelayValue): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeRelayValue);
  if (isTaggedRelayValue(value)) {
    switch (value.$relay) {
      case "undefined":
        return undefined;
      case "date":
        return new Date(value.value);
      case "map":
        return new Map(
          value.value.map(([key, item]) => [decodeRelayValue(key), decodeRelayValue(item)])
        );
      case "set":
        return new Set(value.value.map(decodeRelayValue));
      case "array-buffer":
        return base64ToBytes(value.value).buffer;
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeRelayValue(item)])
  );
}
