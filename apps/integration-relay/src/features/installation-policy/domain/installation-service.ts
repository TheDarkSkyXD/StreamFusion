import type {
  InstallationCredentialGrant,
  InstallationRegistrationRequest
} from "@streamfusion/core/relay";

import type {
  InstallationCredentialAuthority,
  InstallationCredentialClaim,
  InstallationRegistry,
  InstallationRegistryRecord,
  RelayEnvironment,
  RelayInstallationResult
} from "../capabilities/installation-registry";

const CREDENTIAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export function createInstallationService(input: {
  readonly authority: InstallationCredentialAuthority;
  readonly environment: RelayEnvironment;
  readonly now: () => number;
  readonly registry: InstallationRegistry;
}) {
  async function grantFor(
    record: InstallationRegistryRecord
  ): Promise<InstallationCredentialGrant> {
    const reconciledAt = new Date(input.now()).toISOString();
    const credentialExpiresAt = new Date(
      record.activeExpiresAtEpochMs
    ).toISOString();
    return {
      credential: await input.authority.issue({
        environment: record.environment,
        expiresAtEpochMs: record.activeExpiresAtEpochMs,
        generation: record.activeGeneration,
        installationId: record.installationId
      }),
      credentialExpiresAt,
      generation: record.activeGeneration,
      reconciledAt
    };
  }

  async function recordForClaim(credential: string) {
    const claim = await input.authority.verify({ credential });
    if (claim === null || claim.environment !== input.environment) return null;
    const record = await input.registry.get({
      environment: claim.environment,
      installationId: claim.installationId
    });
    if (record === null || record.environment !== input.environment)
      return null;
    return { claim, record };
  }

  return {
    async authenticatedInstallation(credential: string): Promise<{
      readonly environment: RelayEnvironment;
      readonly installationId: string;
    } | null> {
      const matched = await recordForClaim(credential);
      return matched === null
        ? null
        : {
            environment: matched.record.environment,
            installationId: matched.record.installationId
          };
    },
    async authorizeRead(
      credential: string
    ): Promise<InstallationCredentialClaim | null> {
      const matched = await recordForClaim(credential);
      if (matched === null) return null;
      const now = input.now();
      if (
        matched.claim.generation !== matched.record.activeGeneration ||
        matched.claim.expiresAtEpochMs !==
          matched.record.activeExpiresAtEpochMs ||
        now >= matched.record.activeExpiresAtEpochMs
      ) {
        return null;
      }
      return matched.claim;
    },

    async register(inputRequest: {
      readonly authorization: string | null;
      readonly request: InstallationRegistrationRequest;
    }): Promise<RelayInstallationResult> {
      if (inputRequest.request.environment !== input.environment) {
        return { kind: "unauthorized" };
      }
      const existing = await input.registry.get({
        environment: inputRequest.request.environment,
        installationId: inputRequest.request.installationId
      });
      const now = input.now();
      if (existing === null) {
        const record: InstallationRegistryRecord = {
          activeExpiresAtEpochMs: now + CREDENTIAL_LIFETIME_MS,
          activeGeneration: 1,
          environment: inputRequest.request.environment,
          installationId: inputRequest.request.installationId,
          lastRegistrationId: inputRequest.request.registrationId,
          lastRotationId: null,
          replayExpiresAtEpochMs: null,
          replayGeneration: null,
          registrationGeneration: 1,
          revision: 1
        };
        if (!(await input.registry.insert(record)))
          return { kind: "unavailable" };
        return { kind: "grant", grant: await grantFor(record) };
      }

      if (
        existing.lastRegistrationId === inputRequest.request.registrationId &&
        existing.registrationGeneration === existing.activeGeneration &&
        now < existing.activeExpiresAtEpochMs
      ) {
        return { kind: "grant", grant: await grantFor(existing) };
      }

      if (inputRequest.authorization === null) return { kind: "unauthorized" };
      const matched = await recordForClaim(inputRequest.authorization);
      if (
        matched === null ||
        matched.claim.environment !== existing.environment ||
        matched.record.installationId !== existing.installationId ||
        matched.claim.generation !== existing.activeGeneration
      ) {
        return { kind: "unauthorized" };
      }

      const reconciled: InstallationRegistryRecord = {
        ...existing,
        activeExpiresAtEpochMs: now + CREDENTIAL_LIFETIME_MS,
        activeGeneration: existing.activeGeneration + 1,
        lastRegistrationId: inputRequest.request.registrationId,
        registrationGeneration: existing.activeGeneration + 1,
        lastRotationId: null,
        replayExpiresAtEpochMs: null,
        replayGeneration: null,
        revision: existing.revision + 1
      };
      if (!(await input.registry.replace(reconciled)))
        return { kind: "unavailable" };
      return { kind: "grant", grant: await grantFor(reconciled) };
    },

    async rotate(inputRequest: {
      readonly credential: string;
      readonly rotationId: string;
    }): Promise<RelayInstallationResult> {
      const matched = await recordForClaim(inputRequest.credential);
      if (matched === null) return { kind: "unauthorized" };
      const now = input.now();
      const { claim, record } = matched;
      if (
        record.lastRotationId === inputRequest.rotationId &&
        record.replayGeneration === claim.generation &&
        record.replayExpiresAtEpochMs !== null &&
        now < record.replayExpiresAtEpochMs
      ) {
        return { kind: "grant", grant: await grantFor(record) };
      }
      if (
        claim.generation !== record.activeGeneration ||
        now >= record.activeExpiresAtEpochMs
      ) {
        return { kind: "unauthorized" };
      }

      const rotated: InstallationRegistryRecord = {
        ...record,
        activeExpiresAtEpochMs: now + CREDENTIAL_LIFETIME_MS,
        activeGeneration: record.activeGeneration + 1,
        lastRotationId: inputRequest.rotationId,
        replayExpiresAtEpochMs: now + CREDENTIAL_LIFETIME_MS,
        replayGeneration: record.activeGeneration,
        registrationGeneration: record.registrationGeneration,
        revision: record.revision + 1
      };
      if (!(await input.registry.replace(rotated)))
        return { kind: "unavailable" };
      return { kind: "grant", grant: await grantFor(rotated) };
    }
  };
}
