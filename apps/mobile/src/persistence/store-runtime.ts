import type {
  MobilePersistenceRuntime,
  PersistenceProofResult,
  PersistenceRuntimeState,
  SecureRandomSource,
  SecureSecretStore,
} from "@mobile/capabilities/persistence";

import { CacheStore, DEFAULT_CACHE_MAXIMUM_BYTES } from "./cache-store";
import {
  type EncryptedDatabaseDriver,
  SqlCipherUnavailableError,
  type StoreDatabase,
} from "./database-contracts";
import {
  applyMigrations,
  cacheMigrations,
  productMigrations,
  readSchemaVersion,
  type StoreMigration,
} from "./migrations";
import { ProductStore } from "./product-store";

const keyPattern = /^[a-f0-9]{64}$/u;

interface OpenStoreSet {
  readonly cache: CacheStore;
  readonly cacheDatabase: StoreDatabase;
  readonly cacheSchemaVersion: number;
  readonly cipherVersion: string;
  readonly product: ProductStore;
  readonly productDatabase: StoreDatabase;
  readonly productSchemaVersion: number;
  readonly recoveredProductStore: boolean;
}

export interface MobileStoreRuntimeOptions {
  readonly backupExcluded: boolean;
  readonly databaseDriver: EncryptedDatabaseDriver;
  readonly namespace?: string;
  readonly now?: () => number;
  readonly productMigrationSet?: readonly StoreMigration[];
  readonly random: SecureRandomSource;
  readonly secretStore: SecureSecretStore;
}

function names(namespace: string) {
  if (!/^[a-z0-9-]+$/u.test(namespace))
    throw new Error("The persistence namespace is invalid.");
  return {
    backup: `streamfusion-${namespace}-product.backup.db`,
    backupKey: `streamfusion.${namespace}.product-backup-key.v1`,
    cache: `streamfusion-${namespace}-cache.db`,
    cacheKey: `streamfusion.${namespace}.cache-key.v1`,
    product: `streamfusion-${namespace}-product.db`,
    productKey: `streamfusion.${namespace}.product-key.v1`,
  };
}

async function getOrCreateKey(options: {
  readonly databaseExists: boolean;
  readonly keyName: string;
  readonly mayDiscardDatabase: boolean;
  readonly randomKey: () => Promise<string>;
  readonly secretStore: SecureSecretStore;
}): Promise<
  | { readonly created: boolean; readonly kind: "key"; readonly value: string }
  | { readonly kind: "missing" }
> {
  const existing = await options.secretStore.get(options.keyName);
  if (existing !== null) {
    if (!keyPattern.test(existing))
      throw new Error(
        `SecureStore contains an invalid key at ${options.keyName}.`,
      );
    return { created: false, kind: "key", value: existing };
  }
  if (options.databaseExists && !options.mayDiscardDatabase)
    return { kind: "missing" };
  const created = await options.randomKey();
  if (!keyPattern.test(created))
    throw new Error("The generated database key is invalid.");
  await options.secretStore.set(options.keyName, created);
  return { created: true, kind: "key", value: created };
}

async function integrityIsHealthy(database: StoreDatabase): Promise<boolean> {
  const cipherRows = await database.query<Record<string, string>>(
    "PRAGMA cipher_integrity_check",
  );
  const quickRows =
    await database.query<Record<string, string>>("PRAGMA quick_check");
  const cipherHealthy =
    cipherRows.length === 0 ||
    cipherRows.every((row) =>
      Object.values(row).every((value) => value === "ok"),
    );
  const quickHealthy =
    quickRows.length > 0 &&
    quickRows.every((row) =>
      Object.values(row).every((value) => value === "ok"),
    );
  return cipherHealthy && quickHealthy;
}

class ProductStoreRecoveryError extends Error {
  constructor(
    readonly artifact: string,
    readonly cause: unknown,
  ) {
    super("The Product Store could not be repaired or restored.");
    this.name = "ProductStoreRecoveryError";
  }
}

async function openProduct(options: {
  readonly backupName: string;
  readonly backupKey: string;
  readonly databaseDriver: EncryptedDatabaseDriver;
  readonly databaseName: string;
  readonly encryptionKey: string;
  readonly migrations: readonly StoreMigration[];
}): Promise<{
  readonly database: StoreDatabase;
  readonly recovered: boolean;
  readonly schemaVersion: number;
}> {
  let database: StoreDatabase | undefined;
  try {
    database = await options.databaseDriver.open(
      options.databaseName,
      options.encryptionKey,
    );
    if (!(await integrityIsHealthy(database)))
      throw new Error("Product Store integrity check failed.");
  } catch (initialError) {
    await database?.close().catch(() => undefined);
    if (initialError instanceof SqlCipherUnavailableError) throw initialError;
    if (!options.databaseDriver.exists(options.backupName)) throw initialError;
    const artifact = await options.databaseDriver.quarantine(
      options.databaseName,
      "integrity-failure",
    );
    try {
      await options.databaseDriver.restore(
        options.backupName,
        options.databaseName,
        options.backupKey,
        options.encryptionKey,
      );
      database = await options.databaseDriver.open(
        options.databaseName,
        options.encryptionKey,
      );
      if (!(await integrityIsHealthy(database)))
        throw new Error("Restored Product Store failed integrity checks.");
    } catch (restoreError) {
      throw new ProductStoreRecoveryError(artifact, restoreError);
    }
    return {
      database,
      recovered: true,
      schemaVersion: await applyMigrations({
        database,
        migrations: options.migrations,
      }),
    };
  }

  const oldVersion = await readSchemaVersion(database);
  if (
    oldVersion > 0 &&
    oldVersion < (options.migrations.at(-1)?.version ?? 0)
  ) {
    await options.databaseDriver.backup(
      database,
      options.backupName,
      options.backupKey,
    );
  }
  try {
    return {
      database,
      recovered: false,
      schemaVersion: await applyMigrations({
        database,
        migrations: options.migrations,
      }),
    };
  } catch (migrationError) {
    await database.close().catch(() => undefined);
    const artifact = await options.databaseDriver.quarantine(
      options.databaseName,
      "migration-failure",
    );
    if (!options.databaseDriver.exists(options.backupName)) {
      throw new ProductStoreRecoveryError(artifact, migrationError);
    }
    try {
      await options.databaseDriver.restore(
        options.backupName,
        options.databaseName,
        options.backupKey,
        options.encryptionKey,
      );
      const restored = await options.databaseDriver.open(
        options.databaseName,
        options.encryptionKey,
      );
      if (!(await integrityIsHealthy(restored)))
        throw new Error("Restored Product Store failed integrity checks.");
      await restored.close();
      throw new ProductStoreRecoveryError(artifact, migrationError);
    } catch (restoreError) {
      if (restoreError instanceof ProductStoreRecoveryError) throw restoreError;
      throw new ProductStoreRecoveryError(artifact, restoreError);
    }
  }
}

export function createMobileStoreRuntime(
  options: MobileStoreRuntimeOptions,
): MobilePersistenceRuntime {
  const namespace = options.namespace ?? "main";
  const storeNames = names(namespace);
  const randomKey = options.random.databaseKey;
  const now = options.now ?? Date.now;
  const configuredProductMigrations =
    options.productMigrationSet ?? productMigrations;
  let initializePromise: Promise<PersistenceRuntimeState> | undefined;
  let stores: OpenStoreSet | undefined;

  async function openStores(
    productMigrationSet: readonly StoreMigration[] = configuredProductMigrations,
    maximumCacheBytes = DEFAULT_CACHE_MAXIMUM_BYTES,
  ): Promise<OpenStoreSet | PersistenceRuntimeState> {
    if (!(await options.secretStore.isAvailable())) {
      return {
        kind: "unavailable",
        reason: "secure-store-unavailable",
        message: "SecureStore is unavailable. No Product data was written.",
      };
    }
    const productDatabaseExisted = options.databaseDriver.exists(
      storeNames.product,
    );
    const productKey = await getOrCreateKey({
      databaseExists: productDatabaseExisted,
      keyName: storeNames.productKey,
      mayDiscardDatabase: false,
      randomKey,
      secretStore: options.secretStore,
    });
    if (productKey.kind === "missing") {
      return {
        kind: "recovery-required",
        reason: "product-key-missing",
        artifact: storeNames.product,
        message:
          "The Product Store key is missing. The encrypted file was preserved for recovery.",
      };
    }
    const backupDatabaseExisted = options.databaseDriver.exists(
      storeNames.backup,
    );
    const backupKey = await getOrCreateKey({
      databaseExists: backupDatabaseExisted,
      keyName: storeNames.backupKey,
      mayDiscardDatabase: true,
      randomKey,
      secretStore: options.secretStore,
    });
    if (backupKey.kind === "missing")
      throw new Error("Backup keys may always be recreated.");
    if (backupDatabaseExisted && backupKey.created)
      await options.databaseDriver.delete(storeNames.backup);

    let productResult;
    try {
      productResult = await openProduct({
        backupName: storeNames.backup,
        backupKey: backupKey.value,
        databaseDriver: options.databaseDriver,
        databaseName: storeNames.product,
        encryptionKey: productKey.value,
        migrations: productMigrationSet,
      });
    } catch (error) {
      if (error instanceof SqlCipherUnavailableError) {
        if (!productDatabaseExisted) {
          await options.databaseDriver.delete(storeNames.product);
          await options.secretStore.delete(storeNames.productKey);
        }
        if (backupKey.created) {
          await options.databaseDriver.delete(storeNames.backup);
          await options.secretStore.delete(storeNames.backupKey);
        }
        return {
          kind: "unavailable",
          reason: "sqlcipher-unavailable",
          message:
            "Encrypted storage needs the StreamFusion development client. No Product data was written.",
        };
      }
      if (error instanceof ProductStoreRecoveryError) {
        return {
          kind: "recovery-required",
          reason: "product-store-unrecoverable",
          artifact: error.artifact,
          message:
            "The Product Store was quarantined. Export the recovery artifact before an explicit reset.",
        };
      }
      throw error;
    }

    const cacheDatabaseExisted = options.databaseDriver.exists(
      storeNames.cache,
    );
    const cacheKey = await getOrCreateKey({
      databaseExists: cacheDatabaseExisted,
      keyName: storeNames.cacheKey,
      mayDiscardDatabase: true,
      randomKey,
      secretStore: options.secretStore,
    });
    if (cacheKey.kind === "missing")
      throw new Error("Cache keys may always be recreated.");
    if (cacheDatabaseExisted && cacheKey.created)
      await options.databaseDriver.delete(storeNames.cache);
    try {
      const cacheDatabase = await options.databaseDriver.open(
        storeNames.cache,
        cacheKey.value,
      );
      const cacheSchemaVersion = await applyMigrations({
        database: cacheDatabase,
        migrations: cacheMigrations,
      });
      return {
        cache: new CacheStore(cacheDatabase, {
          maximumBytes: maximumCacheBytes,
          now,
        }),
        cacheDatabase,
        cacheSchemaVersion,
        cipherVersion: productResult.database.cipherVersion,
        product: new ProductStore(productResult.database),
        productDatabase: productResult.database,
        productSchemaVersion: productResult.schemaVersion,
        recoveredProductStore: productResult.recovered,
      };
    } catch (error) {
      await productResult.database.close().catch(() => undefined);
      if (error instanceof SqlCipherUnavailableError) {
        if (!cacheDatabaseExisted) {
          await options.databaseDriver.delete(storeNames.cache);
          await options.secretStore.delete(storeNames.cacheKey);
        }
        return {
          kind: "unavailable",
          reason: "sqlcipher-unavailable",
          message:
            "Encrypted storage needs the StreamFusion development client. No Product data was written.",
        };
      }
      throw error;
    }
  }

  async function initialize(): Promise<PersistenceRuntimeState> {
    if (stores) return readyState(stores);
    const opened = await openStores();
    if ("kind" in opened) return opened;
    stores = opened;
    return readyState(opened);
  }

  return {
    async close() {
      const open = stores;
      stores = undefined;
      initializePromise = undefined;
      if (open) await Promise.all([open.product.close(), open.cache.close()]);
    },
    initialize() {
      initializePromise ??= initialize();
      return initializePromise;
    },
    runProof() {
      return runPersistenceProof({
        backupExcluded: options.backupExcluded,
        databaseDriver: options.databaseDriver,
        now,
        randomUuid: options.random.uuid,
        randomKey,
        secretStore: options.secretStore,
      });
    },
  };
}

function readyState(stores: OpenStoreSet): PersistenceRuntimeState {
  return {
    kind: "ready",
    cacheSchemaVersion: stores.cacheSchemaVersion,
    cipherVersion: stores.cipherVersion,
    productSchemaVersion: stores.productSchemaVersion,
    recoveredProductStore: stores.recoveredProductStore,
  };
}

async function runPersistenceProof(options: {
  readonly backupExcluded: boolean;
  readonly databaseDriver: EncryptedDatabaseDriver;
  readonly now: () => number;
  readonly randomKey: () => Promise<string>;
  readonly randomUuid: () => string;
  readonly secretStore: SecureSecretStore;
}): Promise<PersistenceProofResult> {
  const proofNamespace = `proof-${options.randomUuid().toLowerCase()}`;
  const proofNames = names(proofNamespace);
  const migrationNamespace = `${proofNamespace}-migration`;
  const migrationNames = names(migrationNamespace);
  const marker = `native-encryption-marker-${options.randomUuid()}`;
  const runtimes: MobilePersistenceRuntime[] = [];
  const openDatabases = new Set<StoreDatabase>();
  try {
    const productKey = await options.randomKey();
    const cacheKey = await options.randomKey();
    const backupKey = await options.randomKey();
    await options.secretStore.set(proofNames.productKey, productKey);
    await options.secretStore.set(proofNames.cacheKey, cacheKey);
    await options.secretStore.set(proofNames.backupKey, backupKey);

    const productDatabase = await options.databaseDriver.open(
      proofNames.product,
      productKey,
    );
    openDatabases.add(productDatabase);
    await applyMigrations({
      database: productDatabase,
      migrations: productMigrations,
    });
    const product = new ProductStore(productDatabase);
    await product.setSetting({
      key: "proof",
      updatedAt: options.now(),
      value: marker,
    });
    await product.close();
    openDatabases.delete(productDatabase);
    const encryptedAtRest = !(await options.databaseDriver.containsBytes(
      proofNames.product,
      marker,
    ));

    let wrongKeyRejected = false;
    try {
      const wrongKeyDatabase = await options.databaseDriver.open(
        proofNames.product,
        "0".repeat(64),
      );
      await wrongKeyDatabase.close();
    } catch {
      wrongKeyRejected = true;
    }

    const reopened = await options.databaseDriver.open(
      proofNames.product,
      productKey,
    );
    openDatabases.add(reopened);
    const reopenedProduct = new ProductStore(reopened);
    const offlineRead =
      (await reopenedProduct.getSetting("proof"))?.value === marker;
    await reopenedProduct.close();
    openDatabases.delete(reopened);

    const migrationProductKey = await options.randomKey();
    await options.secretStore.set(
      migrationNames.productKey,
      migrationProductKey,
    );
    const oldestDatabase = await options.databaseDriver.open(
      migrationNames.product,
      migrationProductKey,
    );
    openDatabases.add(oldestDatabase);
    await applyMigrations({
      database: oldestDatabase,
      migrations: productMigrations.slice(0, 1),
    });
    const oldestProduct = new ProductStore(oldestDatabase);
    await oldestProduct.setSetting({
      key: "migration-proof",
      updatedAt: options.now(),
      value: marker,
    });
    await oldestProduct.close();
    openDatabases.delete(oldestDatabase);

    const failingRuntime = createMobileStoreRuntime({
      ...options,
      namespace: migrationNamespace,
      random: { databaseKey: options.randomKey, uuid: options.randomUuid },
      productMigrationSet: [
        ...productMigrations.slice(0, 1),
        {
          version: 2,
          statements: [
            "CREATE TABLE migration_failure_probe (id INTEGER PRIMARY KEY) STRICT",
            "THIS IS NOT VALID SQL",
          ],
        },
      ],
    });
    runtimes.push(failingRuntime);
    const failedMigrationState = await failingRuntime.initialize();
    await failingRuntime.close();
    const restoredAfterFailure = await options.databaseDriver.open(
      migrationNames.product,
      migrationProductKey,
    );
    openDatabases.add(restoredAfterFailure);
    const restoredProduct = new ProductStore(restoredAfterFailure);
    const failedMigrationRestored =
      failedMigrationState.kind === "recovery-required" &&
      (await readSchemaVersion(restoredAfterFailure)) === 1 &&
      (await restoredProduct.getSetting("migration-proof"))?.value === marker;
    await restoredProduct.close();
    openDatabases.delete(restoredAfterFailure);
    const backupEncrypted = !(await options.databaseDriver.containsBytes(
      migrationNames.backup,
      marker,
    ));

    const currentRuntime = createMobileStoreRuntime({
      ...options,
      namespace: migrationNamespace,
      random: { databaseKey: options.randomKey, uuid: options.randomUuid },
    });
    runtimes.push(currentRuntime);
    const migratedState = await currentRuntime.initialize();
    await currentRuntime.close();
    await options.databaseDriver.corrupt(migrationNames.product);
    const recoveryRuntime = createMobileStoreRuntime({
      ...options,
      namespace: migrationNamespace,
      random: { databaseKey: options.randomKey, uuid: options.randomUuid },
    });
    runtimes.push(recoveryRuntime);
    const recoveredState = await recoveryRuntime.initialize();
    await recoveryRuntime.close();
    const migrationRecovery =
      failedMigrationRestored &&
      backupEncrypted &&
      migratedState.kind === "ready" &&
      migratedState.productSchemaVersion === 2 &&
      recoveredState.kind === "ready" &&
      recoveredState.recoveredProductStore;

    const cacheDatabase = await options.databaseDriver.open(
      proofNames.cache,
      cacheKey,
    );
    openDatabases.add(cacheDatabase);
    await applyMigrations({
      database: cacheDatabase,
      migrations: cacheMigrations,
    });
    let proofTime = options.now();
    const cache = new CacheStore(cacheDatabase, {
      maximumBytes: 10,
      now: () => {
        proofTime += 1;
        return proofTime;
      },
    });
    await cache.put({
      freshnessMilliseconds: 0,
      key: "expired",
      payload: "expired",
      sizeBytes: 7,
    });
    await cache.put({ key: "old", payload: "123456", sizeBytes: 6 });
    await cache.put({ key: "new", payload: "abcdef", sizeBytes: 6 });
    const cacheEviction =
      (await cache.get("expired")).kind === "miss" &&
      (await cache.get("old")).kind === "miss" &&
      (await cache.get("new")).kind === "hit" &&
      (await cache.sizeBytes()) <= 10;
    await cache.clear();
    await cache.close();
    openDatabases.delete(cacheDatabase);

    const productAfterCacheClear = await options.databaseDriver.open(
      proofNames.product,
      productKey,
    );
    openDatabases.add(productAfterCacheClear);
    const cacheIsolation =
      (await new ProductStore(productAfterCacheClear).getSetting("proof"))
        ?.value === marker;
    await productAfterCacheClear.close();
    openDatabases.delete(productAfterCacheClear);

    const storedProductKey = await options.secretStore.get(
      proofNames.productKey,
    );
    const storedCacheKey = await options.secretStore.get(proofNames.cacheKey);
    const storedBackupKey = await options.secretStore.get(proofNames.backupKey);
    return {
      backupExcluded: options.backupExcluded,
      cacheEviction,
      cacheIsolation,
      encryptedAtRest,
      migrationRecovery,
      offlineRead,
      secureStore:
        storedProductKey === productKey &&
        storedCacheKey === cacheKey &&
        storedBackupKey === backupKey &&
        new Set([productKey, cacheKey, backupKey]).size === 3,
      wrongKeyRejected,
    };
  } finally {
    await Promise.all(
      [...openDatabases].map((database) =>
        database.close().catch(() => undefined),
      ),
    );
    await Promise.all(
      runtimes.map((runtime) => runtime.close().catch(() => undefined)),
    );
    await cleanupProof(options, [proofNames, migrationNames]);
  }
}

async function cleanupProof(
  options: {
    readonly databaseDriver: EncryptedDatabaseDriver;
    readonly secretStore: SecureSecretStore;
  },
  nameSets: readonly ReturnType<typeof names>[],
): Promise<void> {
  const operations: Promise<unknown>[] = [];
  for (const storeNames of nameSets) {
    operations.push(
      options.databaseDriver.delete(storeNames.product),
      options.databaseDriver.delete(storeNames.cache),
      options.databaseDriver.delete(storeNames.backup),
      options.databaseDriver.deleteQuarantines(storeNames.product),
      options.secretStore.delete(storeNames.productKey),
      options.secretStore.delete(storeNames.cacheKey),
      options.secretStore.delete(storeNames.backupKey),
    );
  }
  await Promise.allSettled(operations);
}
