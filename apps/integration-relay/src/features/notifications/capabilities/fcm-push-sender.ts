import type { SafeNotificationPayload } from "@streamfusion/core/relay";

export type FcmSendResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "credential-mismatch" }
  | { readonly kind: "retryable"; readonly retryAfterMs: number }
  | { readonly kind: "unregistered" }
  | { readonly kind: "rejected" };

export interface FcmPushSender {
  sendDirect(input: {
    readonly nativeToken: string;
    readonly payload: SafeNotificationPayload;
    readonly silent: boolean;
    readonly ttlSeconds: number;
  }): Promise<FcmSendResult>;
}
