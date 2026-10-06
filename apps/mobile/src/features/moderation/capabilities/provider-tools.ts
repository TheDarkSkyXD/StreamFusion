import type {
  ModerationChannel,
  ProviderCredential,
  ProviderResult,
} from "./moderation";

export type ChannelTool =
  | "stream-info"
  | "shield"
  | "automod-policy"
  | "blocked-terms"
  | "community"
  | "rewards"
  | "raid-targets";
export type StreamInfo = {
  readonly kind: "stream-info";
  readonly title: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly language: string;
  readonly tags: readonly string[];
  readonly labels: readonly string[];
  readonly availableLabels: readonly {
    readonly id: string;
    readonly name: string;
  }[];
};
export const automodCategories = [
  "aggression",
  "bullying",
  "disability",
  "misogyny",
  "race_ethnicity_or_religion",
  "sex_based_terms",
  "sexuality_sex_or_gender",
  "swearing",
] as const;
export type AutoModCategory = (typeof automodCategories)[number];
export type AutoModPolicy = {
  readonly kind: "automod-policy";
  readonly overall: number | null;
  readonly categories: Readonly<Record<AutoModCategory, number>>;
};
export type Person = {
  readonly id: string;
  readonly login: string;
  readonly name: string;
};
export type ToolSnapshot =
  | StreamInfo
  | AutoModPolicy
  | {
      readonly kind: "shield";
      readonly active: boolean;
      readonly activatedAt: string;
    }
  | {
      readonly kind: "blocked-terms";
      readonly terms: readonly { readonly id: string; readonly text: string }[];
      readonly cursor: string | null;
    }
  | {
      readonly kind: "community";
      readonly people: readonly Person[];
      readonly total: number;
      readonly cursor: string | null;
    }
  | {
      readonly kind: "rewards";
      readonly rewards: readonly {
        readonly id: string;
        readonly title: string;
        readonly cost: number;
      }[];
      readonly redemptions: readonly Redemption[];
      readonly cursor: string | null;
      readonly rewardId: string | null;
    }
  | {
      readonly kind: "raid-targets";
      readonly targets: readonly {
        readonly id: string;
        readonly login: string;
        readonly name: string;
        readonly title: string;
        readonly viewers: number;
      }[];
      readonly cursor: string | null;
    };
export type Redemption = {
  readonly id: string;
  readonly rewardId: string;
  readonly title: string;
  readonly userId: string;
  readonly name: string;
  readonly input: string;
  readonly status: "UNFULFILLED" | "FULFILLED" | "CANCELED";
  readonly redeemedAt: string;
};
export type ChannelToolCommand =
  | { readonly kind: "stream-info"; readonly value: StreamInfo }
  | { readonly kind: "shield"; readonly active: boolean }
  | { readonly kind: "automod-policy"; readonly value: AutoModPolicy }
  | { readonly kind: "add-term"; readonly text: string }
  | { readonly kind: "remove-term"; readonly id: string }
  | { readonly kind: "raid"; readonly targetId: string }
  | { readonly kind: "cancel-raid" }
  | {
      readonly kind: "reward-decision";
      readonly rewardId: string;
      readonly redemptionId: string;
      readonly status: "FULFILLED" | "CANCELED";
    }
  | {
      readonly kind: "suspicious-status";
      readonly userId: string;
      readonly status: "ACTIVE_MONITORING" | "RESTRICTED" | "NO_TREATMENT";
    }
  | {
      readonly kind: "whisper";
      readonly userId: string;
      readonly text: string;
    };
export type ToolCommandResult =
  | { readonly kind: "confirmed" }
  | {
      readonly kind: "raid-pending";
      readonly targetId: string;
      readonly createdAt: string;
      readonly viewers: number | null;
    };
export interface ChannelToolsGateway {
  read(
    channel: ModerationChannel,
    credential: ProviderCredential,
    tool: ChannelTool,
    signal: AbortSignal,
    cursor?: string | null,
    rewardId?: string | null,
  ): Promise<ProviderResult<ToolSnapshot>>;
  execute(
    channel: ModerationChannel,
    credential: ProviderCredential,
    command: ChannelToolCommand,
    signal: AbortSignal,
    beforeSubmit: () => Promise<boolean>,
  ): Promise<ProviderResult<ToolCommandResult>>;
  searchCategories(
    credential: ProviderCredential,
    query: string,
    signal: AbortSignal,
    cursor?: string | null,
  ): Promise<ProviderResult<CategoryPage>>;
}
export type CategoryPage = {
  readonly query: string;
  readonly categories: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly cursor: string | null;
};
export type FeedKind =
  "automod" | "actions" | "activity" | "suspicious" | "rewards" | "whispers";
export type ObservedEvent = {
  readonly id: string;
  readonly occurredAt: string;
  readonly userId: string | null;
  readonly name: string;
  readonly detail: string;
  readonly action: string;
  readonly messageId: string | null;
  readonly rewardId: string | null;
  readonly redemptionId: string | null;
  readonly status: string | null;
};
export type FeedState =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting" }
  | {
      readonly kind: "live" | "disconnected";
      readonly since: string;
      readonly items: readonly ObservedEvent[];
    }
  | {
      readonly kind: "permission";
      readonly detail: string;
      readonly scopes: readonly string[];
    }
  | { readonly kind: "failure"; readonly detail: string };
export interface ModerationFeedGateway {
  subscribe(
    channel: ModerationChannel,
    credential: ProviderCredential,
    feed: FeedKind,
    receive: (state: FeedState) => void,
    signal: AbortSignal,
  ): Promise<void>;
}
