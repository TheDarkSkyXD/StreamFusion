export interface DatabaseRunResult {
  readonly changes: number;
  readonly lastInsertRowId: number;
}

export type DatabaseValue =
  ArrayBuffer | boolean | null | number | string | Uint8Array;

export interface StoreDatabase {
  readonly cipherVersion: string;
  readonly path: string;
  close(): Promise<void>;
  execute(source: string): Promise<void>;
  first<T>(source: string, parameters?: DatabaseValue[]): Promise<T | null>;
  query<T>(source: string, parameters?: DatabaseValue[]): Promise<T[]>;
  run(source: string, parameters?: DatabaseValue[]): Promise<DatabaseRunResult>;
  transaction(
    operation: (database: StoreDatabase) => Promise<void>,
  ): Promise<void>;
}

export interface EncryptedDatabaseDriver {
  backup(
    source: StoreDatabase,
    backupName: string,
    encryptionKey: string,
  ): Promise<void>;
  containsBytes(databaseName: string, value: string): Promise<boolean>;
  corrupt(databaseName: string): Promise<void>;
  delete(databaseName: string): Promise<void>;
  deleteQuarantines(databaseName: string): Promise<void>;
  exists(databaseName: string): boolean;
  open(databaseName: string, encryptionKey: string): Promise<StoreDatabase>;
  quarantine(databaseName: string, reason: string): Promise<string>;
  restore(
    backupName: string,
    databaseName: string,
    backupKey: string,
    databaseKey: string,
  ): Promise<void>;
}

export class SqlCipherUnavailableError extends Error {
  constructor() {
    super("The installed SQLite runtime does not include SQLCipher.");
    this.name = "SqlCipherUnavailableError";
  }
}
