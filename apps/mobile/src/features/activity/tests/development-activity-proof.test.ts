import type { ActivityItem } from "@streamfusion/core/activity";
import type {
  ActivityRepository,
  MobilePersistenceRuntime,
  PersistenceRuntimeState,
  SecureSecretStore,
} from "@mobile/features/storage/capabilities/persistence";
import type { EncryptedDatabaseDriver } from "@mobile/features/storage/data/database-contracts";
import { describe, expect, it, vi } from "vitest";

import { createExpoSecureRandomSource } from "@mobile/features/storage/adapters/expo-secure-random-source";

import { createDevelopmentActivityProof } from "../composition/development-activity-proof";

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
}));

function repository(
  items: Map<string, ActivityItem> = new Map(),
): ActivityRepository {
  return {
    dismissCompleted: async (eventIds) => ({
      activeEventIds: [],
      alreadyDismissedEventIds: [],
      dismissedEventIds: eventIds.filter((eventId) => items.delete(eventId)),
      missingEventIds: eventIds.filter((eventId) => !items.has(eventId)),
    }),
    list: async () => [...items.values()],
    markAllRead: async () => 0,
    markRead: async () => null,
    record: async (item) => {
      const existing = items.get(item.eventId);
      items.set(item.eventId, existing ?? item);
      return {
        item: existing ?? item,
        kind: existing ? "reconciled" : "created",
      };
    },
  };
}

function secretStore(): SecureSecretStore & {
  failDelete: boolean;
  failGet: boolean;
  failSet: boolean;
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  const result = {
    delete: async (key) => {
      if (result.failDelete)
        throw new Error("temporary SecureStore delete failure");
      values.delete(key);
    },
    get: async (key) => {
      if (result.failGet) throw new Error("temporary SecureStore failure");
      return values.get(key) ?? null;
    },
    isAvailable: async () => true,
    set: async (key, value) => {
      if (result.failSet)
        throw new Error("temporary SecureStore write failure");
      values.set(key, value);
    },
    failDelete: false,
    failGet: false,
    failSet: false,
    values,
  } satisfies SecureSecretStore & {
    failDelete: boolean;
    failGet: boolean;
    failSet: boolean;
    readonly values: Map<string, string>;
  };
  return result;
}

function driver(): EncryptedDatabaseDriver & {
  readonly deleted: string[];
  failDelete: boolean;
} {
  const deleted: string[] = [];
  const result = {
    backup: async () => undefined,
    containsBytes: async () => false,
    corrupt: async () => undefined,
    delete: async (name) => {
      if (result.failDelete) throw new Error("cleanup failed");
      deleted.push(name);
    },
    deleteQuarantines: async (name) => void deleted.push(`${name}:quarantines`),
    exists: () => false,
    failDelete: false,
    open: async () => {
      throw new Error("not used by this composition test");
    },
    quarantine: async () => "proof-quarantine",
    restore: async () => undefined,
    deleted,
  } satisfies EncryptedDatabaseDriver & {
    readonly deleted: string[];
    failDelete: boolean;
  };
  return result;
}

const ready: PersistenceRuntimeState = {
  cacheSchemaVersion: 1,
  cipherVersion: "proof",
  kind: "ready",
  productSchemaVersion: 3,
  recoveredProductStore: false,
};

function runtime(
  activity: ActivityRepository,
  state = ready,
  close = vi.fn(async () => undefined),
): MobilePersistenceRuntime {
  return {
    close,
    initialize: vi.fn(async () => state),
    productState: {
      activity,
      capabilityProfile: {
        read: async () => null,
        write: async () => undefined,
      },
      guestFollows: {
        list: async () => [],
        remove: async () => undefined,
        upsert: async () => {
          throw new Error("unused");
        },
      },
      installationIdentityPresence: {
        read: async () => null,
        write: async () => undefined,
      },
      installationPolicy: {
        read: async () => null,
        write: async () => undefined,
      },
      liveNotifications: {
        read: async () => {
          throw new Error("unused");
        },
        write: async () => {
          throw new Error("unused");
        },
      },
      shellRestoration: {
        clear: async () => undefined,
        read: async () => null,
        write: async () => undefined,
      },
    },
    runProof: async () => ({
      backupExcluded: true,
      cacheEviction: true,
      cacheIsolation: true,
      encryptedAtRest: true,
      migrationRecovery: true,
      offlineRead: true,
      secureStore: true,
      wrongKeyRejected: true,
    }),
  };
}

const proofUuid = "11111111-1111-4111-8111-111111111111";

describe("development Activity proof", () => {
  it("canonicalizes the compact Expo UUID before opening the real proof factory", async () => {
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: driver(),
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: createExpoSecureRandomSource().uuid,
      secretStore: secretStore(),
    });

    await proof.start();

    expect(proof.snapshot()).toMatchObject({
      kind: "proof",
      namespace: `activity-proof-${proofUuid}`,
    });
  });

  it("rejects malformed random identifiers before writing a proof marker", async () => {
    const secrets = secretStore();
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: driver(),
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => "not-a-uuid",
      secretStore: secrets,
    });

    await proof.start();

    expect(proof.snapshot()).toMatchObject({ kind: "unavailable" });
    expect(secrets.values).toHaveLength(0);
  });

  it("reuses one durable namespace and routes reads to the isolated Product repository", async () => {
    const main = repository();
    const proofItems = new Map<string, ActivityItem>();
    const proofRepository = repository(proofItems);
    const createRuntime = vi.fn(() => runtime(proofRepository));
    const proof = createDevelopmentActivityProof({
      createRuntime,
      databaseDriver: driver(),
      mainRepository: main,
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secretStore(),
    });

    await proof.start();
    await proof.start();

    expect(createRuntime).toHaveBeenCalledOnce();
    expect(proof.snapshot()).toMatchObject({
      kind: "proof",
      namespace: `activity-proof-${proofUuid}`,
    });
    expect((await proof.repository.list()).map((item) => item.eventId)).toEqual(
      [
        "proof:activity:channel-completed:v1",
        "proof:activity:system-completed:v1",
        "proof:activity:job-terminal:v1",
        "proof:activity:job-active:v1",
      ],
    );
    expect(await main.list()).toEqual([]);

    proof.queueNextReadFailure();
    await expect(proof.repository.list()).rejects.toThrow(
      "Development Activity list failure.",
    );
    expect(await proof.repository.list()).toHaveLength(4);
  });

  it("recovers the saved namespace and replays stable items without replacing local state", async () => {
    const secrets = secretStore();
    const proofItems = new Map<string, ActivityItem>();
    const proofRepository = repository(proofItems);
    const options = {
      createRuntime: () => runtime(proofRepository),
      databaseDriver: driver(),
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    };
    const first = createDevelopmentActivityProof(options);
    await first.start();
    const channel = proofItems.get("proof:activity:channel-completed:v1");
    if (!channel) throw new Error("Missing seeded proof channel.");
    proofItems.set(channel.eventId, {
      ...channel,
      readAt: "2026-09-08T01:00:00.000Z" as typeof channel.readAt,
    });

    const reopened = createDevelopmentActivityProof(options);
    const record = vi.spyOn(proofRepository, "record");
    await reopened.recover();
    await reopened.replayCompleted();

    expect(reopened.snapshot()).toMatchObject({ kind: "proof" });
    expect(proofItems.get(channel.eventId)?.readAt).toBe(
      "2026-09-08T01:00:00.000Z",
    );
    expect(proofItems.size).toBe(4);
    expect(record).toHaveBeenCalledTimes(3);
  });

  it("retries a transient marker read instead of overwriting a session state", async () => {
    const secrets = secretStore();
    secrets.failGet = true;
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: driver(),
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });

    await proof.start();
    expect(proof.snapshot()).toMatchObject({ kind: "unavailable" });
    secrets.failGet = false;
    await proof.start();

    expect(proof.snapshot()).toMatchObject({ kind: "proof" });
  });

  it("retains selected proof identity across a transient marker read failure", async () => {
    const secrets = secretStore();
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: driver(),
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });
    await proof.start();
    secrets.failGet = true;
    await proof.exit();

    expect(proof.snapshot()).toMatchObject({
      kind: "proof",
      namespace: `activity-proof-${proofUuid}`,
    });
    await expect(proof.repository.list()).resolves.toHaveLength(4);
    secrets.failGet = false;
    await proof.exit();
    expect(proof.snapshot()).toMatchObject({ kind: "main" });
  });

  it("does not seed interrupted initialization or cleanup sessions during recovery", async () => {
    const marker =
      "streamfusion.development.issue141.activity-proof-session.v1";
    const baseline = { count: 0, digest: "811c9dc5" };
    for (const phase of ["initializing", "cleanup"] as const) {
      const secrets = secretStore();
      secrets.values.set(
        marker,
        JSON.stringify({
          mainActivity: baseline,
          namespace: `activity-proof-${proofUuid}`,
          phase,
          version: 1,
        }),
      );
      const proofRepository = repository();
      const record = vi.spyOn(proofRepository, "record");
      const createRuntime = vi.fn(() => runtime(proofRepository));
      const proof = createDevelopmentActivityProof({
        createRuntime,
        databaseDriver: driver(),
        mainRepository: repository(),
        now: () => Date.parse("2026-09-08T00:00:00.000Z"),
        randomUuid: () => proofUuid,
        secretStore: secrets,
      });

      await proof.recover();
      await proof.start();

      expect(createRuntime).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(proof.snapshot()).toMatchObject({ kind: "cleanup-required" });
    }
  });

  it("keeps interrupted cleanup truthful when cleanup intent cannot be saved", async () => {
    const secrets = secretStore();
    secrets.values.set(
      "streamfusion.development.issue141.activity-proof-session.v1",
      JSON.stringify({
        mainActivity: { count: 0, digest: "811c9dc5" },
        namespace: `activity-proof-${proofUuid}`,
        phase: "initializing",
        version: 1,
      }),
    );
    const main = repository();
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: driver(),
      mainRepository: main,
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });
    await proof.recover();
    secrets.failSet = true;
    await proof.retryCleanup();

    expect(proof.snapshot()).toMatchObject({
      kind: "cleanup-required",
      selected: false,
    });
    expect(proof.repository).toBe(main);
  });

  it("keeps cleanup retry visible when its marker read transiently fails", async () => {
    const secrets = secretStore();
    const storageDriver = driver();
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: storageDriver,
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });
    await proof.start();
    storageDriver.failDelete = true;
    await proof.exit();
    secrets.failGet = true;
    await proof.retryCleanup();

    expect(proof.snapshot()).toMatchObject({
      kind: "cleanup-required",
      selected: true,
    });
  });

  it("keeps a deactivated cleanup selection out of proof mode when retry cannot save intent", async () => {
    const secrets = secretStore();
    const storageDriver = driver();
    const proofRepository = repository();
    const record = vi.spyOn(proofRepository, "record");
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(proofRepository),
      databaseDriver: storageDriver,
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });
    await proof.start();
    storageDriver.failDelete = true;
    await proof.exit();
    const recordsBeforeRetry = record.mock.calls.length;
    secrets.failSet = true;

    await proof.retryCleanup();
    await proof.replayCompleted();

    expect(proof.snapshot()).toMatchObject({
      kind: "cleanup-required",
      selected: true,
    });
    expect(record).toHaveBeenCalledTimes(recordsBeforeRetry);
  });

  it("keeps selected proof identity visible when its durable marker becomes invalid", async () => {
    const secrets = secretStore();
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: driver(),
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });
    await proof.start();
    secrets.values.set(
      "streamfusion.development.issue141.activity-proof-session.v1",
      "invalid marker",
    );
    await proof.exit();

    expect(proof.snapshot()).toMatchObject({
      kind: "cleanup-required",
      namespace: `activity-proof-${proofUuid}`,
      selected: true,
    });
  });

  it("rejects stale proof mutation callbacks while exact cleanup awaits close", async () => {
    let resolveClose: (() => void) | null = null;
    let resolveList: (() => void) | null = null;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const main = repository();
    const proofRepository = repository();
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(proofRepository, ready, close),
      databaseDriver: driver(),
      mainRepository: main,
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secretStore(),
    });
    await proof.start();
    const stale = proof.repository;
    const item = (await stale.list())[0];
    if (!item) throw new Error("Missing proof item.");
    proofRepository.list = vi.fn(
      () =>
        new Promise<readonly ActivityItem[]>((resolve) => {
          resolveList = () => resolve([]);
        }),
    );
    const runningList = stale.list();

    const exiting = proof.exit();
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    resolveList?.();
    await runningList;
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

    expect(() =>
      stale.dismissCompleted([item.eventId], item.occurredAt),
    ).toThrow("closing");
    expect(() => stale.markAllRead(item.occurredAt)).toThrow("closing");
    expect(() => stale.record(item)).toThrow("closing");
    resolveClose?.();
    await exiting;
    expect(await main.list()).toEqual([]);
  });

  it("compares the nonsecret main Activity ID and read-state baseline before clearing a proof session", async () => {
    const secrets = secretStore();
    const main = repository();
    const proofRepository = repository(new Map<string, ActivityItem>());
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(proofRepository),
      databaseDriver: driver(),
      mainRepository: main,
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });

    await proof.start();
    const proofItem = (await proof.repository.list())[0];
    if (!proofItem) throw new Error("Missing seeded proof item.");
    await main.record(proofItem);
    await proof.exit();

    expect(proof.snapshot()).toEqual({
      detail:
        "Main Activity is selected. Its ID or read-state baseline changed during this proof, so preservation was not verified.",
      kind: "main",
    });
    expect(secrets.values).toHaveLength(0);
  });

  it("rejects an invalid durable marker without replacing it or opening another namespace", async () => {
    const secrets = secretStore();
    const marker =
      "streamfusion.development.issue141.activity-proof-session.v1";
    secrets.values.set(marker, "not a proof session");
    const createRuntime = vi.fn(() => runtime(repository()));
    const proof = createDevelopmentActivityProof({
      createRuntime,
      databaseDriver: driver(),
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });

    await proof.start();

    expect(proof.snapshot()).toMatchObject({ kind: "unavailable" });
    expect(createRuntime).not.toHaveBeenCalled();
    expect(secrets.values.get(marker)).toBe("not a proof session");
  });

  it("retains the exact marker after startup or cleanup failure and supports retry", async () => {
    const secrets = secretStore();
    const storageDriver = driver();
    const proof = createDevelopmentActivityProof({
      createRuntime: () => runtime(repository()),
      databaseDriver: storageDriver,
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });
    await proof.start();
    storageDriver.failDelete = true;
    await proof.exit();

    expect(proof.snapshot()).toMatchObject({
      kind: "cleanup-required",
      namespace: `activity-proof-${proofUuid}`,
    });
    expect(secrets.values.size).toBeGreaterThan(0);

    storageDriver.failDelete = false;
    await proof.retryCleanup();

    expect(proof.snapshot()).toEqual({
      detail:
        "Main Activity is selected. Its ID and read-state baseline was preserved during this proof.",
      kind: "main",
    });
    expect(storageDriver.deleted).toEqual(
      expect.arrayContaining([
        `streamfusion-activity-proof-${proofUuid}-product.db`,
        `streamfusion-activity-proof-${proofUuid}-cache.db`,
        `streamfusion-activity-proof-${proofUuid}-product.backup.db`,
      ]),
    );
    expect(secrets.values).toHaveLength(0);
  });

  it("retains cleanup phase across marker-clear failure and a restarted retry", async () => {
    const secrets = secretStore();
    const storageDriver = driver();
    const options = {
      createRuntime: () => runtime(repository()),
      databaseDriver: storageDriver,
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    };
    const started = createDevelopmentActivityProof(options);
    await started.start();
    secrets.failDelete = true;
    await started.exit();
    expect(started.snapshot()).toMatchObject({ kind: "cleanup-required" });
    expect([...secrets.values.values()][0]).toContain('"phase":"cleanup"');

    secrets.failDelete = false;
    const restarted = createDevelopmentActivityProof(options);
    await restarted.retryCleanup();

    expect(restarted.snapshot()).toMatchObject({ kind: "main" });
    expect(secrets.values).toHaveLength(0);
  });

  it("deactivates a restarted cleanup wrapper before a failed exact deletion can expose it", async () => {
    const secrets = secretStore();
    secrets.values.set(
      "streamfusion.development.issue141.activity-proof-session.v1",
      JSON.stringify({
        mainActivity: { count: 0, digest: "811c9dc5" },
        namespace: `activity-proof-${proofUuid}`,
        phase: "cleanup",
        version: 1,
      }),
    );
    const storageDriver = driver();
    storageDriver.failDelete = true;
    const isolatedRuntime = runtime(repository());
    const createRuntime = vi.fn(() => isolatedRuntime);
    const proof = createDevelopmentActivityProof({
      createRuntime,
      databaseDriver: storageDriver,
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });

    await proof.retryCleanup();

    expect(proof.snapshot()).toMatchObject({
      kind: "cleanup-required",
      selected: true,
    });
    expect(() =>
      proof.repository.record({
        body: "must not reach isolated storage",
        destination: { kind: "diagnostics" },
        event: "device-health",
        eventId: "proof:blocked",
        kind: "system",
        occurredAt: "2026-09-08T00:00:00.000Z" as ActivityItem["occurredAt"],
        readAt: null,
        schemaVersion: 1,
        source: "local",
        title: "Blocked",
      }),
    ).toThrow("closing");
    expect(isolatedRuntime.initialize).not.toHaveBeenCalled();
  });

  it("reopens the exact saved namespace to clean it after a process restart", async () => {
    const secrets = secretStore();
    const storageDriver = driver();
    const proofItems = new Map<string, ActivityItem>();
    const createRuntime = vi.fn(() => runtime(repository(proofItems)));
    const options = {
      createRuntime,
      databaseDriver: storageDriver,
      mainRepository: repository(),
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    };
    const started = createDevelopmentActivityProof(options);
    await started.start();

    const restarted = createDevelopmentActivityProof(options);
    await restarted.exit();

    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(storageDriver.deleted).toEqual(
      expect.arrayContaining([
        `streamfusion-activity-proof-${proofUuid}-product.db`,
        `streamfusion-activity-proof-${proofUuid}-cache.db`,
      ]),
    );
    expect(secrets.values).toHaveLength(0);
  });

  it("keeps main Activity selected and the durable marker available after initialization fails", async () => {
    const secrets = secretStore();
    const main = repository();
    const proof = createDevelopmentActivityProof({
      createRuntime: () =>
        runtime(repository(), {
          diagnostic: { category: "storage-startup", cause: "product-open" },
          kind: "unavailable",
          message: "Unavailable",
          reason: "storage-initialization-failed",
        }),
      databaseDriver: driver(),
      mainRepository: main,
      now: () => Date.parse("2026-09-08T00:00:00.000Z"),
      randomUuid: () => proofUuid,
      secretStore: secrets,
    });

    await proof.start();

    expect(proof.snapshot()).toMatchObject({ kind: "cleanup-required" });
    expect(await proof.repository.list()).toEqual([]);
    expect(
      secrets.values.has(
        "streamfusion.development.issue141.activity-proof-session.v1",
      ),
    ).toBe(true);
  });
});
