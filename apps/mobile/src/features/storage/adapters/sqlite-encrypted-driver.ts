import { Directory, File, Paths } from "expo-file-system";
import {
  backupDatabaseAsync,
  defaultDatabaseDirectory,
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";

import {
  type DatabaseValue,
  type EncryptedDatabaseDriver,
  SqlCipherUnavailableError,
  UNENCRYPTED_STORE_CIPHER_VERSION,
  type StoreDatabase,
} from "../data/database-contracts";
import { runSavepointTransaction } from "./sqlite-transaction";

const encryptionKeyPattern = /^[a-f0-9]{64}$/u;
const sqliteHeaderPrefix = new TextEncoder().encode("SQLite format 3");
const nativeDatabases = new WeakMap<StoreDatabase, SQLiteDatabase>();
let cipherVersionPromise: Promise<string | null> | undefined;

function requireEncryptionKey(value: string): void {
  if (!encryptionKeyPattern.test(value)) {
    throw new Error("The database encryption key is invalid.");
  }
}

function createExclusiveQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

function wrapDatabase(
  database: SQLiteDatabase,
  cipherVersion: string,
): StoreDatabase {
  const enqueueTransaction = createExclusiveQueue();
  const wrapped: StoreDatabase = {
    cipherVersion,
    path: database.databasePath,
    close: () => database.closeAsync(),
    async execute(source) {
      await database.runAsync(source);
    },
    first: <T>(source: string, parameters: DatabaseValue[] = []) =>
      database.getFirstAsync<T>(source, parameters),
    query: <T>(source: string, parameters: DatabaseValue[] = []) =>
      database.getAllAsync<T>(source, parameters),
    async run(source, parameters = []) {
      const result = await database.runAsync(source, parameters);
      return {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowId,
      };
    },
    transaction(operation) {
      return enqueueTransaction(() =>
        runSavepointTransaction(
          (source) => database.execAsync(source),
          () => operation(wrapped),
        ),
      );
    },
  };
  nativeDatabases.set(wrapped, database);
  return wrapped;
}

async function probeCipherVersion(): Promise<string | null> {
  const probe = await openDatabaseAsync(":memory:", {
    useNewConnection: true,
  });
  try {
    const cipher = await probe.getFirstAsync<{
      readonly cipher_version: string;
    }>("PRAGMA cipher_version");
    return cipher?.cipher_version ?? null;
  } finally {
    await probe.closeAsync().catch(() => undefined);
  }
}

function detectCipherVersion(): Promise<string | null> {
  cipherVersionPromise ??= probeCipherVersion();
  return cipherVersionPromise;
}

async function requireCipherVersion(): Promise<string> {
  const cipherVersion = await detectCipherVersion();
  if (!cipherVersion) throw new SqlCipherUnavailableError();
  return cipherVersion;
}

async function applyOpenedDatabasePragmas(
  database: SQLiteDatabase,
  encrypted: boolean,
): Promise<void> {
  if (encrypted) {
    await database.execAsync("PRAGMA cipher_memory_security = ON");
  }
  await database.execAsync("PRAGMA foreign_keys = ON");
  await database.execAsync("PRAGMA journal_mode = WAL");
}

async function openEncryptedDatabase(
  databaseName: string,
  encryptionKey: string,
): Promise<{
  readonly cipherVersion: string;
  readonly database: SQLiteDatabase;
}> {
  requireEncryptionKey(encryptionKey);
  const cipherVersion = await requireCipherVersion();
  const database = await openDatabaseAsync(databaseName);
  try {
    await database.execAsync(`PRAGMA key = "x'${encryptionKey}'"`);
    await database.getFirstAsync("SELECT count(*) AS count FROM sqlite_master");
    await applyOpenedDatabasePragmas(database, true);
    return { cipherVersion, database };
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

async function openPlainDatabase(databaseName: string): Promise<{
  readonly cipherVersion: string;
  readonly database: SQLiteDatabase;
}> {
  const database = await openDatabaseAsync(databaseName);
  try {
    await database.getFirstAsync("SELECT count(*) AS count FROM sqlite_master");
    await applyOpenedDatabasePragmas(database, false);
    return {
      cipherVersion: UNENCRYPTED_STORE_CIPHER_VERSION,
      database,
    };
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

function databaseFile(databaseName: string): File {
  const directory = String(defaultDatabaseDirectory);
  const directoryUri = directory.startsWith("file://")
    ? directory
    : `file://${directory}`;
  return new File(directoryUri, databaseName);
}

function databaseArtifacts(databaseName: string): File[] {
  return ["", "-wal", "-shm", "-journal"].map((suffix) =>
    databaseFile(`${databaseName}${suffix}`),
  );
}

function deleteFileIfPresent(file: File): void {
  if (file.exists) file.delete();
}

function deleteSidecars(databaseName: string): void {
  for (const sidecar of databaseArtifacts(databaseName).slice(1)) {
    deleteFileIfPresent(sidecar);
  }
}

function matchesAt(bytes: Uint8Array, sequence: Uint8Array, offset: number): boolean {
  for (let index = 0; index < sequence.length; index += 1) {
    if (bytes[offset + index] !== sequence[index]) return false;
  }
  return true;
}

function containsSequence(bytes: Uint8Array, sequence: Uint8Array): boolean {
  if (sequence.length === 0 || sequence.length > bytes.length) return false;
  const lastOffset = bytes.length - sequence.length;
  for (let offset = 0; offset <= lastOffset; offset += 1) {
    if (matchesAt(bytes, sequence, offset)) return true;
  }
  return false;
}

function startsWithSequence(bytes: Uint8Array, sequence: Uint8Array): boolean {
  if (sequence.length > bytes.length) return false;
  return matchesAt(bytes, sequence, 0);
}

function nativeDatabaseFor(source: StoreDatabase): SQLiteDatabase {
  const database = nativeDatabases.get(source);
  if (!database) throw new Error("The source database does not belong to this driver.");
  return database;
}

async function deleteEncryptedDatabase(databaseName: string): Promise<void> {
  if (databaseFile(databaseName).exists) {
    await deleteDatabaseAsync(databaseName).catch(() => undefined);
  }
  for (const artifact of databaseArtifacts(databaseName)) {
    deleteFileIfPresent(artifact);
  }
}

async function backupDatabase(
  source: StoreDatabase,
  backupName: string,
  encryptionKey: string,
): Promise<void> {
  await deleteEncryptedDatabase(backupName);
  const unencrypted = source.cipherVersion === UNENCRYPTED_STORE_CIPHER_VERSION;
  const openedBackup = unencrypted
    ? await openPlainDatabase(backupName)
    : await openEncryptedDatabase(backupName, encryptionKey);
  try {
    await backupDatabaseAsync({
      destDatabase: openedBackup.database,
      sourceDatabase: nativeDatabaseFor(source),
    });
    await openedBackup.database.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    await openedBackup.database.closeAsync();
    deleteSidecars(backupName);
  }
}

async function databaseContainsBytes(
  databaseName: string,
  value: string,
): Promise<boolean> {
  const file = databaseFile(databaseName);
  return (
    file.exists &&
    containsSequence(await file.bytes(), new TextEncoder().encode(value))
  );
}

async function databaseAppearsEncrypted(databaseName: string): Promise<boolean> {
  const file = databaseFile(databaseName);
  if (!file.exists) return false;
  const bytes = await file.bytes();
  if (bytes.length === 0) return false;
  // Plain SQLite files begin with "SQLite format 3". SQLCipher ciphertext does not.
  return !startsWithSequence(bytes, sqliteHeaderPrefix);
}

async function corruptDatabase(databaseName: string): Promise<void> {
  const file = databaseFile(databaseName);
  if (!file.exists) {
    throw new Error(`Cannot corrupt missing database ${databaseName}.`);
  }
  deleteSidecars(databaseName);
  file.write(new TextEncoder().encode("corrupt-streamfusion-database"));
}

async function deleteDatabaseQuarantines(databaseName: string): Promise<void> {
  const directory = new Directory(Paths.document, "recovery");
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.name.startsWith(`${databaseName}.`)) {
      entry.delete();
    }
  }
}

async function quarantineEncryptedDatabase(
  databaseName: string,
  reason: string,
  now: () => number,
): Promise<string> {
  const source = databaseFile(databaseName);
  if (!source.exists) return source.uri;
  const directory = new Directory(Paths.document, "recovery");
  directory.create({ idempotent: true, intermediates: true });
  const safeReason = reason.replaceAll(/[^a-z0-9-]/giu, "-").toLowerCase();
  const stamp = `${now()}.${safeReason}.quarantine`;
  let primaryArtifact = source.uri;
  for (const artifact of databaseArtifacts(databaseName)) {
    if (!artifact.exists) continue;
    const destination = new File(directory, `${artifact.name}.${stamp}`);
    await artifact.move(destination);
    if (artifact.name === databaseName) primaryArtifact = destination.uri;
  }
  return primaryArtifact;
}

async function restoreEncryptedDatabase(
  backupName: string,
  databaseName: string,
  backupKey: string,
  databaseKey: string,
): Promise<void> {
  const backup = databaseFile(backupName);
  if (!backup.exists) {
    throw new Error(`Recovery backup ${backupName} is unavailable.`);
  }
  await deleteEncryptedDatabase(databaseName);
  await backup.copy(databaseFile(databaseName), { overwrite: true });
  if (await databaseAppearsEncrypted(databaseName)) {
    requireEncryptionKey(backupKey);
    requireEncryptionKey(databaseKey);
    const restored = await openEncryptedDatabase(databaseName, backupKey);
    try {
      await restored.database.execAsync(`PRAGMA rekey = "x'${databaseKey}'"`);
      await restored.database.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      await restored.database.closeAsync();
    }
  } else {
    const restored = await openPlainDatabase(databaseName);
    try {
      await restored.database.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      await restored.database.closeAsync();
    }
  }
  deleteSidecars(databaseName);
}

export function createSqliteEncryptedDatabaseDriver(
  options: { readonly now?: () => number } = {},
): EncryptedDatabaseDriver {
  const now = options.now ?? Date.now;
  return {
    appearsEncrypted: databaseAppearsEncrypted,
    backup: backupDatabase,
    containsBytes: databaseContainsBytes,
    corrupt: corruptDatabase,
    delete: deleteEncryptedDatabase,
    deleteQuarantines: deleteDatabaseQuarantines,
    exists: (databaseName) => databaseFile(databaseName).exists,
    isSqlCipherAvailable: async () => (await detectCipherVersion()) !== null,
    async open(databaseName, encryptionKey) {
      const opened = await openEncryptedDatabase(databaseName, encryptionKey);
      return wrapDatabase(opened.database, opened.cipherVersion);
    },
    async openUnencrypted(databaseName) {
      const opened = await openPlainDatabase(databaseName);
      return wrapDatabase(opened.database, opened.cipherVersion);
    },
    quarantine: (databaseName, reason) =>
      quarantineEncryptedDatabase(databaseName, reason, now),
    restore: restoreEncryptedDatabase,
  };
}
