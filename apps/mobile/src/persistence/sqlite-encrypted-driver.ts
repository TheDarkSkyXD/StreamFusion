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
  type StoreDatabase,
} from "./database-contracts";

const encryptionKeyPattern = /^[a-f0-9]{64}$/u;
const nativeDatabases = new WeakMap<StoreDatabase, SQLiteDatabase>();
let cipherVersionPromise: Promise<string> | undefined;

function requireEncryptionKey(value: string): void {
  if (!encryptionKeyPattern.test(value))
    throw new Error("The database encryption key is invalid.");
}

function wrapDatabase(
  database: SQLiteDatabase,
  cipherVersion: string,
): StoreDatabase {
  const wrapped: StoreDatabase = {
    cipherVersion,
    path: database.databasePath,
    close: () => database.closeAsync(),
    execute: (source) => database.execAsync(source),
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
      return database.withTransactionAsync(() => operation(wrapped));
    },
  };
  nativeDatabases.set(wrapped, database);
  return wrapped;
}

function detectCipherVersion(): Promise<string> {
  cipherVersionPromise ??= (async () => {
    const probe = await openDatabaseAsync(":memory:", {
      useNewConnection: true,
    });
    try {
      const cipher = await probe.getFirstAsync<{
        readonly cipher_version: string;
      }>("PRAGMA cipher_version");
      if (!cipher?.cipher_version) throw new SqlCipherUnavailableError();
      return cipher.cipher_version;
    } finally {
      await probe.closeAsync().catch(() => undefined);
    }
  })();
  return cipherVersionPromise;
}

async function openEncryptedDatabase(
  databaseName: string,
  encryptionKey: string,
): Promise<{
  readonly cipherVersion: string;
  readonly database: SQLiteDatabase;
}> {
  requireEncryptionKey(encryptionKey);
  const cipherVersion = await detectCipherVersion();
  const database = await openDatabaseAsync(databaseName);
  try {
    await database.execAsync(`PRAGMA key = "x'${encryptionKey}'"`);
    await database.getFirstAsync("SELECT count(*) AS count FROM sqlite_master");
    await database.execAsync(
      "PRAGMA cipher_memory_security = ON; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;",
    );
    return { cipherVersion, database };
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

function containsSequence(bytes: Uint8Array, sequence: Uint8Array): boolean {
  if (sequence.length === 0 || sequence.length > bytes.length) return false;
  for (let offset = 0; offset <= bytes.length - sequence.length; offset += 1) {
    let matches = true;
    for (let index = 0; index < sequence.length; index += 1) {
      if (bytes[offset + index] !== sequence[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

export function createSqliteEncryptedDatabaseDriver(
  options: { readonly now?: () => number } = {},
): EncryptedDatabaseDriver {
  const now = options.now ?? Date.now;
  return {
    async backup(source, backupName, encryptionKey) {
      await this.delete(backupName);
      const openedBackup = await openEncryptedDatabase(
        backupName,
        encryptionKey,
      );
      try {
        const sourceDatabase = nativeDatabases.get(source);
        if (!sourceDatabase)
          throw new Error(
            "The source database does not belong to this driver.",
          );
        await backupDatabaseAsync({
          destDatabase: openedBackup.database,
          sourceDatabase,
        });
        await openedBackup.database.execAsync(
          "PRAGMA wal_checkpoint(TRUNCATE)",
        );
      } finally {
        await openedBackup.database.closeAsync();
        for (const sidecar of databaseArtifacts(backupName).slice(1))
          deleteFileIfPresent(sidecar);
      }
    },
    async containsBytes(databaseName, value) {
      const file = databaseFile(databaseName);
      return (
        file.exists &&
        containsSequence(await file.bytes(), new TextEncoder().encode(value))
      );
    },
    async corrupt(databaseName) {
      const file = databaseFile(databaseName);
      if (!file.exists)
        throw new Error(`Cannot corrupt missing database ${databaseName}.`);
      for (const sidecar of databaseArtifacts(databaseName).slice(1))
        deleteFileIfPresent(sidecar);
      file.write(new TextEncoder().encode("corrupt-streamfusion-database"));
    },
    async delete(databaseName) {
      if (databaseFile(databaseName).exists)
        await deleteDatabaseAsync(databaseName).catch(() => undefined);
      for (const artifact of databaseArtifacts(databaseName))
        deleteFileIfPresent(artifact);
    },
    async deleteQuarantines(databaseName) {
      const directory = new Directory(Paths.document, "recovery");
      if (!directory.exists) return;
      for (const entry of directory.list()) {
        if (entry instanceof File && entry.name.startsWith(`${databaseName}.`))
          entry.delete();
      }
    },
    exists: (databaseName) => databaseFile(databaseName).exists,
    async open(databaseName, encryptionKey) {
      const opened = await openEncryptedDatabase(databaseName, encryptionKey);
      return wrapDatabase(opened.database, opened.cipherVersion);
    },
    async quarantine(databaseName, reason) {
      const source = databaseFile(databaseName);
      if (!source.exists) return source.uri;
      const directory = new Directory(Paths.document, "recovery");
      directory.create({ idempotent: true, intermediates: true });
      const safeReason = reason.replaceAll(/[^a-z0-9-]/giu, "-").toLowerCase();
      const stamp = `${now()}.${safeReason}.quarantine`;
      let primaryArtifact = source.uri;
      for (const artifact of databaseArtifacts(databaseName)) {
        if (!artifact.exists) continue;
        const isPrimary = artifact.name === databaseName;
        const destination = new File(directory, `${artifact.name}.${stamp}`);
        await artifact.move(destination);
        if (isPrimary) primaryArtifact = destination.uri;
      }
      return primaryArtifact;
    },
    async restore(backupName, databaseName, backupKey, databaseKey) {
      requireEncryptionKey(backupKey);
      requireEncryptionKey(databaseKey);
      const backup = databaseFile(backupName);
      if (!backup.exists)
        throw new Error(`Recovery backup ${backupName} is unavailable.`);
      await this.delete(databaseName);
      await backup.copy(databaseFile(databaseName), { overwrite: true });
      const restored = await openEncryptedDatabase(databaseName, backupKey);
      try {
        await restored.database.execAsync(`PRAGMA rekey = "x'${databaseKey}'"`);
        await restored.database.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        await restored.database.closeAsync();
      }
      for (const sidecar of databaseArtifacts(databaseName).slice(1))
        deleteFileIfPresent(sidecar);
    },
  };
}
