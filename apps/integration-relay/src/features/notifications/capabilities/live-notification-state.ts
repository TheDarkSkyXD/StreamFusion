import type {
  LiveNotificationPair,
  SafeNotificationPayload
} from "@streamfusion/core/relay";

export type LiveObservation = {
  readonly pair: LiveNotificationPair;
  readonly sessionKey: string | null;
  readonly eventId: string | null;
  readonly observedAtMs: number;
  readonly payload: SafeNotificationPayload | null;
};

export type PendingLiveDelivery = {
  readonly eventId: string;
  readonly installationId: string;
  readonly pairKey: string;
  readonly payload: SafeNotificationPayload;
  readonly attempts: number;
  readonly expiresAtMs: number;
  readonly leaseToken: string;
};

export interface LiveNotificationState {
  lastObserved(): Promise<
    ReadonlyMap<
      string,
      { readonly observedAtMs: number; readonly sessionKey: string | null }
    >
  >;
  observe(observation: LiveObservation): Promise<void>;
  claimDue(
    nowMs: number,
    limit: number
  ): Promise<readonly PendingLiveDelivery[]>;
  release(delivery: PendingLiveDelivery): Promise<void>;
  lastAlertAt(installationId: string, pairKey: string): Promise<number | null>;
  oldestDuePendingCreatedAt(nowMs: number): Promise<number | null>;
  complete(
    delivery: PendingLiveDelivery,
    nowMs: number,
    outcome: "accepted" | "skipped" | "retry",
    retryAfterMs?: number
  ): Promise<void>;
  cleanup(nowMs: number): Promise<void>;
}
