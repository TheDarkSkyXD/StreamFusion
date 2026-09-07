import type {
  ActivityItem,
  SerializedTimestamp,
} from "@streamfusion/core/activity";

export type PersistenceUnavailableReason =
  | "secure-store-unavailable"
  | "sqlcipher-unavailable"
  | "product-key-missing"
  | "product-store-unrecoverable";

export type PersistenceRuntimeState =
  | { readonly kind: "initializing" }
  | {
      readonly kind: "ready";
      readonly cacheSchemaVersion: number;
      readonly cipherVersion: string;
      readonly productSchemaVersion: number;
      readonly recoveredProductStore: boolean;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: PersistenceUnavailableReason;
      readonly message: string;
    }
  | {
      readonly kind: "recovery-required";
      readonly reason: "product-key-missing" | "product-store-unrecoverable";
      readonly artifact: string;
      readonly message: string;
    };

export interface PersistenceProofResult {
  readonly backupExcluded: boolean;
  readonly cacheEviction: boolean;
  readonly cacheIsolation: boolean;
  readonly encryptedAtRest: boolean;
  readonly migrationRecovery: boolean;
  readonly offlineRead: boolean;
  readonly secureStore: boolean;
  readonly wrongKeyRejected: boolean;
}

export interface MobilePersistenceRuntime {
  readonly productState: MobileProductState;
  close(): Promise<void>;
  initialize(): Promise<PersistenceRuntimeState>;
  runProof(): Promise<PersistenceProofResult>;
}

export type ActivityFilter = "all" | "channels" | "jobs";

export interface ActivityWriteResult {
  readonly item: ActivityItem;
  readonly kind: "created" | "reconciled";
}

export interface ActivityRepository {
  list(filter?: ActivityFilter): Promise<readonly ActivityItem[]>;
  markAllRead(readAt: SerializedTimestamp): Promise<number>;
  markRead(
    eventId: string,
    readAt: SerializedTimestamp,
  ): Promise<ActivityItem | null>;
  record(item: ActivityItem): Promise<ActivityWriteResult>;
}

export interface ShellRestorationRepository {
  clear(): Promise<void>;
  read(): Promise<string | null>;
  write(value: string, updatedAt: number): Promise<void>;
}

export interface MobileProductState {
  readonly activity: ActivityRepository;
  readonly shellRestoration: ShellRestorationRepository;
}

export interface SecureSecretStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  isAvailable(): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
}

export interface SecureRandomSource {
  databaseKey(): Promise<string>;
  uuid(): string;
}
