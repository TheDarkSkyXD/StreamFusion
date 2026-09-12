import type {
  ActivityItem,
  SerializedTimestamp,
} from "@streamfusion/core/activity";
import type {
  GuestFollow,
  LiveNotificationPreferences,
} from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";

export type PersistenceUnavailableReason =
  | "secure-store-unavailable"
  | "sqlcipher-unavailable"
  | "product-key-missing"
  | "product-store-unrecoverable"
  | "storage-initialization-failed";

export type PersistenceStartupDiagnostic = {
  readonly category: "storage-startup";
  readonly cause:
    | "secure-store-availability"
    | "product-key"
    | "backup-key"
    | "product-open"
    | "cache-key"
    | "cache-open"
    | "unknown";
};

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
      readonly diagnostic?: PersistenceStartupDiagnostic;
    }
  | {
      readonly kind: "recovery-required";
      readonly reason: "product-key-missing" | "product-store-unrecoverable";
      readonly artifact: string;
      readonly message: string;
      readonly diagnostic?: PersistenceStartupDiagnostic;
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

export type DisposableCacheRead =
  | { readonly kind: "miss" }
  | {
      readonly kind: "hit";
      readonly ageMilliseconds: number;
      readonly payload: string;
      readonly stale: boolean;
    };

export interface DisposableCache {
  clear(): Promise<void>;
  get(key: string): Promise<DisposableCacheRead>;
  put(options: {
    readonly freshnessMilliseconds?: number;
    readonly key: string;
    readonly payload: string;
  }): Promise<void>;
}

export interface MobilePersistenceRuntime {
  readonly disposableCache: DisposableCache;
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

export interface ActivityDismissalResult {
  readonly activeEventIds: readonly string[];
  readonly alreadyDismissedEventIds: readonly string[];
  readonly dismissedEventIds: readonly string[];
  readonly missingEventIds: readonly string[];
}

export interface ActivityRepository {
  dismissCompleted(
    eventIds: readonly string[],
    dismissedAt: SerializedTimestamp,
  ): Promise<ActivityDismissalResult>;
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

export interface CapabilityProfileSnapshotStore {
  read(): Promise<string | null>;
  write(value: string, observedAtEpochMs: number): Promise<void>;
}

export interface InstallationPolicySnapshotStore {
  read(): Promise<string | null>;
  write(value: string, updatedAtEpochMs: number): Promise<void>;
}

export interface GuestFollowRepository {
  list(): Promise<readonly GuestFollow[]>;
  remove(identity: {
    readonly platform: Platform;
    readonly channelId: string;
  }): Promise<void>;
  upsert(value: unknown): Promise<GuestFollow>;
}

export interface LiveNotificationPreferenceStore {
  read(): Promise<LiveNotificationPreferences>;
  write(value: unknown): Promise<LiveNotificationPreferences>;
}

export interface MobileProductState {
  readonly activity: ActivityRepository;
  readonly capabilityProfile: CapabilityProfileSnapshotStore;
  readonly guestFollows: GuestFollowRepository;
  readonly installationPolicy: InstallationPolicySnapshotStore;
  readonly installationIdentityPresence: InstallationPolicySnapshotStore;
  readonly liveNotifications: LiveNotificationPreferenceStore;
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
