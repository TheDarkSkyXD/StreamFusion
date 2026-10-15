import type { Channel } from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";

export type ChatPresentation = {
  readonly copyText: (text: string) => Promise<void>;
  readonly readChannel?: (
    identity: ChannelIdentity,
    signal: AbortSignal,
  ) => Promise<Pick<
    Channel,
    | "id"
    | "username"
    | "displayName"
    | "avatarUrl"
    | "createdAt"
    | "isLive"
    | "isPartner"
    | "isVerified"
  > | null>;
  readonly viewChannel?: (channel: ChannelIdentity) => void;
};
