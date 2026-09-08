import type { JsonValue, RelaySchema } from "./index.ts";

export const CAPABILITY_MANIFEST_SCHEMA_VERSION = 1;

export type CapabilityManifestEnvironment = "development" | "production";

export type CapabilityManifest = {
  readonly capabilities: readonly string[];
  readonly environment: CapabilityManifestEnvironment;
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly schemaVersion: typeof CAPABILITY_MANIFEST_SCHEMA_VERSION;
  readonly sequence: number;
};

export type SignedCapabilityManifest = {
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly manifest: CapabilityManifest;
  readonly signature: string;
};

const MANIFEST_ENVIRONMENTS = {
  development: true,
  production: true,
} satisfies Record<CapabilityManifestEnvironment, true>;

const MAX_CAPABILITY_COUNT = 128;
const MAX_IDENTIFIER_LENGTH = 128;

export const capabilityManifestSchema: RelaySchema<CapabilityManifest> = {
  is: isCapabilityManifest,
};

export const signedCapabilityManifestSchema: RelaySchema<SignedCapabilityManifest> =
  {
    is: isSignedCapabilityManifest,
  };

export function canonicalizeCapabilityManifest(
  manifest: CapabilityManifest,
): string {
  if (!isCapabilityManifest(manifest)) {
    throw new RangeError("Invalid capability manifest");
  }

  return JSON.stringify({
    capabilities: manifest.capabilities,
    environment: manifest.environment,
    expiresAt: manifest.expiresAt,
    issuedAt: manifest.issuedAt,
    schemaVersion: manifest.schemaVersion,
    sequence: manifest.sequence,
  });
}

function isCapabilityManifest(value: unknown): value is CapabilityManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "capabilities",
      "environment",
      "expiresAt",
      "issuedAt",
      "schemaVersion",
      "sequence",
    ]) ||
    value.schemaVersion !== CAPABILITY_MANIFEST_SCHEMA_VERSION ||
    !isCapabilityManifestEnvironment(value.environment) ||
    !isIsoTimestamp(value.issuedAt) ||
    !isIsoTimestamp(value.expiresAt) ||
    !isPositiveSafeInteger(value.sequence) ||
    !isCapabilityList(value.capabilities)
  ) {
    return false;
  }

  return (
    new Date(value.expiresAt).valueOf() > new Date(value.issuedAt).valueOf()
  );
}

function isSignedCapabilityManifest(
  value: unknown,
): value is SignedCapabilityManifest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["algorithm", "keyId", "manifest", "signature"]) &&
    value.algorithm === "ed25519" &&
    isIdentifier(value.keyId) &&
    isCapabilityManifest(value.manifest) &&
    isBase64Url(value.signature)
  );
}

function isCapabilityManifestEnvironment(
  value: unknown,
): value is CapabilityManifestEnvironment {
  return (
    typeof value === "string" && Object.hasOwn(MANIFEST_ENVIRONMENTS, value)
  );
}

function isCapabilityList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_CAPABILITY_COUNT)
    return false;
  if (!value.every(isIdentifier)) return false;
  return new Set(value).size === value.length;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isBase64Url(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 80 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return (
    !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value
  );
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function hasExactKeys(
  value: Record<string, JsonValue>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
