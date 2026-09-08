import { describe, expect, it } from "vitest";

import { createInstallationService } from "../domain/installation-service";
import type {
  InstallationCredentialAuthority,
  InstallationCredentialClaim,
  InstallationRegistry,
  InstallationRegistryRecord
} from "../capabilities/installation-registry";

const installationId = "52a14548-c5bc-4ba5-9a1c-81dac9b9f2dc";
const firstRegistrationId = "register-95B4xv59NSmcKQz33cAj9g";
const secondRegistrationId = "register-PpJlkhOla1WguoExgl3U6q";
const firstRotationId = "rotate-95B4xv59NSmcKQz33cAj9g";

function createRegistry(): InstallationRegistry {
  const records = new Map<string, InstallationRegistryRecord>();
  const key = (input: { environment: string; installationId: string }) =>
    `${input.environment}:${input.installationId}`;
  return {
    async get(input) {
      return records.get(key(input)) ?? null;
    },
    async insert(input) {
      if (records.has(key(input))) return false;
      records.set(key(input), input);
      return true;
    },
    async replace(input) {
      const existing = records.get(key(input));
      if (existing?.revision !== input.revision - 1) return false;
      records.set(key(input), input);
      return true;
    }
  };
}

function createAuthority(): InstallationCredentialAuthority {
  const claims = new Map<string, InstallationCredentialClaim>();
  return {
    async issue(claim) {
      const credential = `${claim.installationId}.${claim.generation}.${claim.expiresAtEpochMs}`;
      claims.set(credential, claim);
      return credential;
    },
    async verify({ credential }) {
      return claims.get(credential) ?? null;
    }
  };
}

function createService(
  now: () => number,
  environment: "development" | "production" = "development"
) {
  return createInstallationService({
    authority: createAuthority(),
    environment,
    now,
    registry: createRegistry()
  });
}

describe("installation credential reconciliation", () => {
  it("replays an initial registration only with its persisted unpredictable operation id", async () => {
    const service = createService(() => 1_000);
    const request = {
      environment: "development" as const,
      installationId,
      registrationId: firstRegistrationId
    };

    const initial = await service.register({ authorization: null, request });
    const replay = await service.register({ authorization: null, request });
    const unknownOperation = await service.register({
      authorization: null,
      request: { ...request, registrationId: secondRegistrationId }
    });

    expect(initial).toMatchObject({ kind: "grant" });
    expect(replay).toEqual(initial);
    expect(unknownOperation).toEqual({ kind: "unauthorized" });
  });

  it("rejects a registration request for another relay environment", async () => {
    const service = createService(() => 1_000, "development");
    await expect(
      service.register({
        authorization: null,
        request: {
          environment: "production",
          installationId,
          registrationId: firstRegistrationId
        }
      })
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("rejects a valid credential claim from another environment at every service boundary", async () => {
    const productionClaim: InstallationCredentialClaim = {
      environment: "production",
      expiresAtEpochMs: 9_000,
      generation: 1,
      installationId
    };
    const productionRecord: InstallationRegistryRecord = {
      activeExpiresAtEpochMs: 9_000,
      activeGeneration: 1,
      environment: "production",
      installationId,
      lastRegistrationId: firstRegistrationId,
      lastRotationId: null,
      registrationGeneration: 1,
      replayExpiresAtEpochMs: null,
      replayGeneration: null,
      revision: 1
    };
    const service = createInstallationService({
      authority: {
        async issue() {
          return "unused";
        },
        async verify() {
          return productionClaim;
        }
      },
      environment: "development",
      now: () => 1_000,
      registry: {
        async get() {
          return productionRecord;
        },
        async insert() {
          return false;
        },
        async replace() {
          return false;
        }
      }
    });

    await expect(
      service.authenticatedInstallation("valid-production-credential")
    ).resolves.toBeNull();
    await expect(
      service.authorizeRead("valid-production-credential")
    ).resolves.toBeNull();
    await expect(
      service.rotate({
        credential: "valid-production-credential",
        rotationId: firstRotationId
      })
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("replays a lost rotation response through the new grant lifetime, without authorizing the old credential for reads", async () => {
    let now = 1_000;
    const service = createService(() => now);
    const registered = await service.register({
      authorization: null,
      request: {
        environment: "development",
        installationId,
        registrationId: firstRegistrationId
      }
    });
    if (registered.kind !== "grant") throw new Error("expected a grant");

    const rotated = await service.rotate({
      credential: registered.grant.credential,
      rotationId: firstRotationId
    });
    if (rotated.kind !== "grant") throw new Error("expected a rotated grant");
    now += 6 * 24 * 60 * 60 * 1_000;
    const replay = await service.rotate({
      credential: registered.grant.credential,
      rotationId: firstRotationId
    });

    expect(rotated).toMatchObject({ kind: "grant", grant: { generation: 2 } });
    expect(replay).toMatchObject({
      kind: "grant",
      grant: {
        credential: rotated.grant.credential,
        credentialExpiresAt: rotated.grant.credentialExpiresAt,
        generation: 2
      }
    });
    await expect(
      service.authorizeRead(registered.grant.credential)
    ).resolves.toBeNull();
  });

  it("does not let a stale registration operation retrieve a rotated credential", async () => {
    const service = createService(() => 1_000);
    const registered = await service.register({
      authorization: null,
      request: {
        environment: "development",
        installationId,
        registrationId: firstRegistrationId
      }
    });
    if (registered.kind !== "grant") throw new Error("expected a grant");
    await service.rotate({
      credential: registered.grant.credential,
      rotationId: firstRotationId
    });

    await expect(
      service.register({
        authorization: null,
        request: {
          environment: "development",
          installationId,
          registrationId: firstRegistrationId
        }
      })
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("does not replay an expired initial registration grant", async () => {
    let now = 1_000;
    const service = createService(() => now);
    const request = {
      environment: "development" as const,
      installationId,
      registrationId: firstRegistrationId
    };
    await service.register({ authorization: null, request });
    now += 8 * 24 * 60 * 60 * 1_000;

    await expect(
      service.register({ authorization: null, request })
    ).resolves.toEqual({
      kind: "unauthorized"
    });
  });

  it("allows only the current generation to reconcile after expiry and rejects superseded credentials", async () => {
    let now = 1_000;
    const service = createService(() => now);
    const registered = await service.register({
      authorization: null,
      request: {
        environment: "development",
        installationId,
        registrationId: firstRegistrationId
      }
    });
    if (registered.kind !== "grant") throw new Error("expected a grant");
    const rotated = await service.rotate({
      credential: registered.grant.credential,
      rotationId: firstRotationId
    });
    if (rotated.kind !== "grant") throw new Error("expected a rotated grant");

    now += 8 * 24 * 60 * 60 * 1_000;
    const superseded = await service.register({
      authorization: registered.grant.credential,
      request: {
        environment: "development",
        installationId,
        registrationId: secondRegistrationId
      }
    });
    const current = await service.register({
      authorization: rotated.grant.credential,
      request: {
        environment: "development",
        installationId,
        registrationId: secondRegistrationId
      }
    });

    expect(superseded).toEqual({ kind: "unauthorized" });
    expect(current).toMatchObject({ kind: "grant", grant: { generation: 3 } });
    await expect(
      service.authorizeRead(rotated.grant.credential)
    ).resolves.toBeNull();
  });

  it("fails closed after a lost rotation response remains offline beyond its replay expiry", async () => {
    let now = 1_000;
    const service = createService(() => now);
    const registered = await service.register({
      authorization: null,
      request: {
        environment: "development",
        installationId,
        registrationId: firstRegistrationId
      }
    });
    if (registered.kind !== "grant") throw new Error("expected a grant");
    await service.rotate({
      credential: registered.grant.credential,
      rotationId: firstRotationId
    });
    now += 8 * 24 * 60 * 60 * 1_000;

    const replay = await service.rotate({
      credential: registered.grant.credential,
      rotationId: firstRotationId
    });
    const reconcile = await service.register({
      authorization: registered.grant.credential,
      request: {
        environment: "development",
        installationId,
        registrationId: secondRegistrationId
      }
    });

    expect(replay).toEqual({ kind: "unauthorized" });
    expect(reconcile).toEqual({ kind: "unauthorized" });
  });
});
