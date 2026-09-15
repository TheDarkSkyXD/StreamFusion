import type { LiveNotificationProjection } from "@streamfusion/core/relay";

export type NativePushRecord = {
  readonly installationId: string;
  readonly nativeToken: string;
  readonly tokenHash: string;
  readonly tokenType: "fcm";
  readonly projection: LiveNotificationProjection;
  readonly remoteDeliveryEnabled: boolean;
  readonly registeredAt: string;
  readonly rotatedAt: string;
};

export interface NativePushRegistry {
  get(installationId: string): Promise<NativePushRecord | null>;
  listEnabled(): Promise<readonly NativePushRecord[]>;
  upsert(record: NativePushRecord): Promise<void>;
  disable(installationId: string, rotatedAt: string): Promise<boolean>;
  retireByTokenHash(tokenHash: string, rotatedAt: string): Promise<boolean>;
}
