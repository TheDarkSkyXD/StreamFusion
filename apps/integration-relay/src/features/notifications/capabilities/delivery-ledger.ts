export type DeliveryOutcome =
  "accepted" | "local-reconciled" | "retryable" | "terminal-token";

export type DeliveryRecord = {
  readonly eventId: string;
  readonly mode: "direct" | "topic";
  readonly target: string;
  readonly outcome: DeliveryOutcome;
  readonly recordedAt: string;
};

export interface DeliveryLedger {
  get(
    eventId: string,
    mode: DeliveryRecord["mode"],
    target: string
  ): Promise<DeliveryRecord | null>;
  put(record: DeliveryRecord): Promise<void>;
}
