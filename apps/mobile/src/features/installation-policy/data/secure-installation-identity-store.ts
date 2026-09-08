import { installationCredentialGrantSchema } from "@streamfusion/core/relay";

import type { SecureSecretStore } from "@mobile/features/storage/capabilities/persistence";

import type {
  InstallationCredentialStore,
  InstallationIdentityState,
} from "../capabilities/installation-policy";

const INSTALLATION_IDENTITY_KEY = "installation-policy.identity.v1";

export function createSecureInstallationIdentityStore(
  secretStore: SecureSecretStore,
): InstallationCredentialStore {
  let pendingWrite: Promise<void> = Promise.resolve();
  return {
    async read() {
      await pendingWrite.catch(() => undefined);
      const serialized = await secretStore.get(INSTALLATION_IDENTITY_KEY);
      if (serialized === null) return { kind: "empty" };
      const state = parseIdentityState(serialized);
      return state === null ? { kind: "corrupt" } : { kind: "ready", state };
    },
    async write(state) {
      const serialized = JSON.stringify({
        ...state,
        credential:
          state.credential === null
            ? null
            : {
                credential: state.credential.credential,
                credentialExpiresAt: state.credential.credentialExpiresAt,
                generation: state.credential.generation,
                reconciledAt: state.credential.reconciledAt,
              },
      });
      const write = pendingWrite
        .catch(() => undefined)
        .then(() => secretStore.set(INSTALLATION_IDENTITY_KEY, serialized));
      pendingWrite = write;
      await write;
    },
  };
}

function parseIdentityState(value: string): InstallationIdentityState | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, [
        "credential",
        "installationId",
        "pendingRegistrationId",
        "pendingRotationId",
      ])
    ) {
      return null;
    }
    if (!isIdentifier(parsed.installationId)) return null;
    if (!isOptionalOperationId(parsed.pendingRegistrationId)) return null;
    if (!isOptionalOperationId(parsed.pendingRotationId)) return null;
    if (
      parsed.credential !== null &&
      !installationCredentialGrantSchema.is(parsed.credential)
    ) {
      return null;
    }
    return {
      credential:
        parsed.credential === null
          ? null
          : { ...parsed.credential, installationId: parsed.installationId },
      installationId: parsed.installationId,
      pendingRegistrationId: parsed.pendingRegistrationId,
      pendingRotationId: parsed.pendingRotationId,
    };
  } catch {
    return null;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

function isOptionalOperationId(value: unknown): value is string | null {
  return value === null || (isIdentifier(value) && value.length >= 22);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
