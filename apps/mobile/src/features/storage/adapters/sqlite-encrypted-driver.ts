import {
  requireStorageModule,
  type NativeDatabaseValue,
} from "../../../../modules/streamfusion-native-contracts/src/storage";

import {
  type DatabaseValue,
  type EncryptedDatabaseDriver,
  SqlCipherUnavailableError,
  type StoreDatabase,
} from "../data/database-contracts";
import { runSavepointTransaction } from "./sqlite-transaction";

const encryptionKeyPattern = /^[a-f0-9]{64}$/u;

function requireEncryptionKey(value: string): void {
  if (!encryptionKeyPattern.test(value)) {
    throw new Error("The database encryption key is invalid.");
  }
}

function toNativeValue(value: DatabaseValue): NativeDatabaseValue {
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { kind: "blob", base64: btoa(binary) };
  }
  return value;
}

function toNativeValues(values: DatabaseValue[]): NativeDatabaseValue[] {
  return values.map(toNativeValue);
}

function fromNativeValue(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "blob" ||
    !("base64" in value) ||
    typeof value.base64 !== "string"
  ) {
    return value;
  }
  const binary = atob(value.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function fromNativeRow(row: unknown): Record<string, unknown> {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("The database returned an invalid row.");
  }
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, fromNativeValue(value)]),
  );
}

function createExclusiveQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
}

function wrapDatabase(opened: {
  readonly handle: number;
  readonly path: string;
  readonly cipherVersion: string;
}): StoreDatabase {
  const native = requireStorageModule();
  const enqueue = createExclusiveQueue();
  let closed = false;

  function requireOpen(): void {
    if (closed) throw new Error("The database is closed.");
  }

  function directDatabase(): StoreDatabase {
    const direct: StoreDatabase = {
      cipherVersion: opened.cipherVersion,
      path: opened.path,
      async close() {
        throw new Error("A transaction cannot close its database.");
      },
      async execute(source) {
        requireOpen();
        await native.execute(opened.handle, source);
      },
      async first<T>(source: string, parameters: DatabaseValue[] = []) {
        const rows = await direct.query<T>(source, parameters);
        return rows[0] ?? null;
      },
      async query<T>(source: string, parameters: DatabaseValue[] = []) {
        requireOpen();
        const rows = await native.query(opened.handle, source, toNativeValues(parameters));
        return rows.map(fromNativeRow) as T[];
      },
      async run(source, parameters = []) {
        requireOpen();
        return native.run(opened.handle, source, toNativeValues(parameters));
      },
      transaction(operation) {
        requireOpen();
        return runSavepointTransaction(direct.execute, () => operation(direct));
      },
    };
    return direct;
  }

  const direct = directDatabase();
  return {
    cipherVersion: opened.cipherVersion,
    path: opened.path,
    close: () => enqueue(async () => {
      if (closed) return;
      await native.closeDatabase(opened.handle);
      closed = true;
    }),
    execute: (source) => enqueue(() => direct.execute(source)),
    first: <T>(source: string, parameters: DatabaseValue[] = []) =>
      enqueue(() => direct.first<T>(source, parameters)),
    query: <T>(source: string, parameters: DatabaseValue[] = []) =>
      enqueue(() => direct.query<T>(source, parameters)),
    run: (source, parameters = []) => enqueue(() => direct.run(source, parameters)),
    transaction: (operation) =>
      enqueue(() => runSavepointTransaction(
        direct.execute,
        () => operation(direct),
      )),
  };
}

const handles = new WeakMap<StoreDatabase, number>();

export function createSqliteEncryptedDatabaseDriver(
  options: { readonly now?: () => number } = {},
): EncryptedDatabaseDriver {
  const now = options.now ?? Date.now;
  const native = requireStorageModule();
  async function open(databaseName: string, key: string | null): Promise<StoreDatabase> {
    if (key !== null) requireEncryptionKey(key);
    const opened = await native.openDatabase(databaseName, key);
    const database = wrapDatabase(opened);
    handles.set(database, opened.handle);
    return database;
  }

  return {
    appearsEncrypted: (name) => native.databaseAppearsEncrypted(name),
    async backup(source, backupName, encryptionKey) {
      requireEncryptionKey(encryptionKey);
      const handle = handles.get(source);
      if (handle === undefined) {
        throw new Error("The source database does not belong to this driver.");
      }
      await native.backupDatabase(handle, backupName, encryptionKey);
    },
    containsBytes: (name, value) => native.databaseContainsBytes(name, value),
    corrupt: (name) => native.corruptDatabase(name),
    delete: (name) => native.deleteDatabase(name),
    deleteQuarantines: (name) => native.deleteQuarantines(name),
    exists: (name) => native.databaseExists(name),
    async isSqlCipherAvailable() {
      return (await native.cipherVersion()) !== null;
    },
    async open(databaseName, key) {
      if ((await native.cipherVersion()) === null) throw new SqlCipherUnavailableError();
      return open(databaseName, key);
    },
    openUnencrypted: (name) => open(name, null),
    quarantine: (name, reason) => native.quarantineDatabase(name, reason, now()),
    async restore(backupName, name, backupKey, key) {
      requireEncryptionKey(backupKey);
      requireEncryptionKey(key);
      await native.restoreDatabase(backupName, name, backupKey, key);
    },
  };
}
