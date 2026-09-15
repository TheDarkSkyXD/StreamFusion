import type { SafeNotificationPayload } from "@streamfusion/core/relay";

export type FcmSendResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "retryable"; readonly retryAfterMs: number }
  | { readonly kind: "unregistered" };

export interface FcmPushSender {
  sendDirect(
    token: string,
    payload: SafeNotificationPayload
  ): Promise<FcmSendResult>;
  sendTopic(
    topic: string,
    payload: SafeNotificationPayload
  ): Promise<FcmSendResult>;
}
