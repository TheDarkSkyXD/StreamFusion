import { NativeModules } from "react-native";

export type NativeDatabaseValue =
  | boolean
  | null
  | number
  | string
  | { readonly kind: "blob"; readonly base64: string };

export interface NativeDatabaseOpenResult {
  readonly handle: number;
  readonly path: string;
  readonly cipherVersion: string;
}

export interface NativeDatabaseRunResult {
  readonly changes: number;
  readonly lastInsertRowId: number;
}

export interface NativeStorageModule {
  databaseExists(name: string): boolean;
  randomBytes(length: number): string;
  randomUuid(): string;
  openDatabase(name: string, key: string | null): Promise<NativeDatabaseOpenResult>;
  execute(handle: number, source: string): Promise<void>;
  query(handle: number, source: string, parameters: readonly NativeDatabaseValue[]): Promise<unknown[]>;
  run(handle: number, source: string, parameters: readonly NativeDatabaseValue[]): Promise<NativeDatabaseRunResult>;
  closeDatabase(handle: number): Promise<void>;
  backupDatabase(handle: number, backupName: string, key: string): Promise<void>;
  restoreDatabase(backupName: string, name: string, backupKey: string, key: string): Promise<void>;
  databaseAppearsEncrypted(name: string): Promise<boolean>;
  databaseContainsBytes(name: string, value: string): Promise<boolean>;
  corruptDatabase(name: string): Promise<void>;
  deleteDatabase(name: string): Promise<void>;
  deleteQuarantines(name: string): Promise<void>;
  quarantineDatabase(name: string, reason: string, timestamp: number): Promise<string>;
  cipherVersion(): Promise<string | null>;
  secretGet(key: string): Promise<string | null>;
  secretSet(key: string, value: string): Promise<void>;
  secretDelete(key: string): Promise<void>;
  secretIsAvailable(): Promise<boolean>;
}

export function getStorageModule(): NativeStorageModule | null {
  return NativeModules.StreamFusionStorage ?? null;
}

export function requireStorageModule(): NativeStorageModule {
  const module = getStorageModule();
  if (!module) throw new Error("StreamFusionStorage is unavailable in this runtime.");
  return module;
}
