import type { PlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type { Platform } from "@streamfusion/core/platform";

export type ProviderCredential = Extract<PlatformAccess, { kind: "ready" }>;
export type ProviderFailure = {
  readonly kind: "failure";
  readonly reason:
    | "auth"
    | "permission"
    | "network"
    | "rate-limit"
    | "invalid"
    | "unsupported"
    | "provider";
  readonly detail: string;
};
export type ProviderResult<T> =
  { readonly kind: "success"; readonly value: T } | ProviderFailure;
export type ModerationChannel = {
  readonly platform: Platform;
  readonly id: string;
  readonly login: string;
  readonly name: string;
};
export type ModerationCommand =
  | {
      readonly kind: "timeout";
      readonly userId: string;
      readonly durationSeconds: number;
      readonly reason: string;
    }
  | { readonly kind: "ban"; readonly userId: string; readonly reason: string }
  | { readonly kind: "unban"; readonly userId: string }
  | { readonly kind: "delete-message"; readonly messageId: string }
  | {
      readonly kind: "automod";
      readonly messageId: string;
      readonly action: "ALLOW" | "DENY";
    }
  | {
      readonly kind: "resolve-unban";
      readonly requestId: string;
      readonly status: "approved" | "denied";
      readonly resolutionText: string;
    }
  | {
      readonly kind: "membership";
      readonly group: "moderators" | "vips";
      readonly operation: "add" | "remove";
      readonly userId: string;
    }
  | { readonly kind: "chat-settings"; readonly settings: ChatSettings };
export type ChatSettings = {
  readonly slowMode: boolean;
  readonly slowSeconds: number;
  readonly followersOnly: boolean;
  readonly followerMinutes: number;
  readonly subscribersOnly: boolean;
  readonly emoteOnly: boolean;
  readonly uniqueChat: boolean;
};
export type BannedUser = {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
  readonly expiresAt: string;
};
export type BannedPage = {
  readonly users: readonly BannedUser[];
  readonly cursor: string | null;
};
export type ReviewTool = "unban-requests" | "moderators" | "vips";
export type ReviewItem =
  | { readonly kind: "member"; readonly userId: string; readonly name: string }
  | {
      readonly kind: "unban";
      readonly id: string;
      readonly userId: string;
      readonly name: string;
      readonly text: string;
    };
export type ReviewPage = {
  readonly tool: ReviewTool;
  readonly items: readonly ReviewItem[];
  readonly cursor: string | null;
};
export interface ModerationGateway {
  channels(
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<readonly ModerationChannel[]>>;
  verify(
    channel: ModerationChannel,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<"broadcaster" | "moderator">>;
  execute(
    channel: ModerationChannel,
    command: ModerationCommand,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<void>>;
  settings(
    channel: ModerationChannel,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<ChatSettings>>;
  banned(
    channel: ModerationChannel,
    cursor: string | null,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<BannedPage>>;
  review(
    channel: ModerationChannel,
    tool: ReviewTool,
    cursor: string | null,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<ReviewPage>>;
}
