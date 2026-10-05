import type {
  ModerationChannel,
  ProviderCredential,
  ProviderResult,
} from "@mobile/features/moderation/capabilities/moderation";

export type EngagementChoice = {
  readonly id: string;
  readonly title: string;
  readonly votes: number;
};
export type ChannelPoll = {
  readonly id: string;
  readonly title: string;
  readonly status:
    | "ACTIVE"
    | "COMPLETED"
    | "TERMINATED"
    | "ARCHIVED"
    | "MODERATED"
    | "INVALID";
  readonly choices: readonly EngagementChoice[];
};
export type ChannelPrediction = {
  readonly id: string;
  readonly title: string;
  readonly status: "ACTIVE" | "LOCKED" | "RESOLVED" | "CANCELED";
  readonly outcomes: readonly EngagementChoice[];
  readonly winningOutcomeId: string | null;
};
export type EngagementCommand =
  | {
      readonly kind: "create-poll";
      readonly title: string;
      readonly choices: readonly string[];
      readonly durationSeconds: number;
    }
  | {
      readonly kind: "end-poll";
      readonly id: string;
      readonly archive: boolean;
    }
  | {
      readonly kind: "create-prediction";
      readonly title: string;
      readonly outcomes: readonly string[];
      readonly durationSeconds: number;
    }
  | {
      readonly kind: "lock-prediction" | "cancel-prediction";
      readonly id: string;
    }
  | {
      readonly kind: "resolve-prediction";
      readonly id: string;
      readonly winningOutcomeId: string;
    };
export type EngagementUpdate =
  | { readonly kind: "poll"; readonly poll: ChannelPoll }
  | { readonly kind: "prediction"; readonly prediction: ChannelPrediction };
export interface EngagementGateway {
  polls(
    channel: ModerationChannel,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<readonly ChannelPoll[]>>;
  predictions(
    channel: ModerationChannel,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<readonly ChannelPrediction[]>>;
  execute(
    channel: ModerationChannel,
    command: EngagementCommand,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<EngagementUpdate>>;
}
