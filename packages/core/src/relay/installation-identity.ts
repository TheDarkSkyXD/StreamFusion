import type { RelaySchema } from "./index.ts";

export type InstallationRegistrationRequest = {
  readonly environment: "development" | "production";
  readonly installationId: string;
  /** Persisted before the request so a lost response can be replayed safely. */
  readonly registrationId: string;
};

export type InstallationRotationRequest = {
  readonly rotationId: string;
};

export type InstallationCredentialGrant = {
  readonly credential: string;
  readonly credentialExpiresAt: string;
  readonly generation: number;
  readonly reconciledAt: string;
};

const INSTALLATION_ENVIRONMENTS = {
  development: true,
  production: true,
} as const;

const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_IDENTIFIER_LENGTH = 128;

export const installationCredentialGrantSchema: RelaySchema<InstallationCredentialGrant> =
  {
    is: isInstallationCredentialGrant,
  };

export const installationRotationRequestSchema: RelaySchema<InstallationRotationRequest> =
  {
    is: isInstallationRotationRequest,
  };

export const installationRegistrationRequestSchema: RelaySchema<InstallationRegistrationRequest> =
  {
    is: isInstallationRegistrationRequest,
  };

function isInstallationRegistrationRequest(
  value: unknown,
): value is InstallationRegistrationRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["environment", "installationId", "registrationId"]) &&
    isEnvironment(value.environment) &&
    isIdentifier(value.installationId) &&
    isOperationIdentifier(value.registrationId)
  );
}

function isInstallationRotationRequest(
  value: unknown,
): value is InstallationRotationRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["rotationId"]) &&
    isOperationIdentifier(value.rotationId)
  );
}

function isInstallationCredentialGrant(
  value: unknown,
): value is InstallationCredentialGrant {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "credential",
      "credentialExpiresAt",
      "generation",
      "reconciledAt",
    ]) ||
    !isCredential(value.credential) ||
    !isIsoTimestamp(value.credentialExpiresAt) ||
    !isIsoTimestamp(value.reconciledAt) ||
    !isPositiveSafeInteger(value.generation)
  ) {
    return false;
  }

  return (
    new Date(value.credentialExpiresAt).valueOf() >
    new Date(value.reconciledAt).valueOf()
  );
}

function isEnvironment(value: unknown): value is "development" | "production" {
  return (
    typeof value === "string" && Object.hasOwn(INSTALLATION_ENVIRONMENTS, value)
  );
}

function isCredential(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= MAX_CREDENTIAL_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isOperationIdentifier(value: unknown): value is string {
  return isIdentifier(value) && value.length >= 22;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return (
    !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
