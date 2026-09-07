import type { TokenStatusResult } from "@shared/ipc-channels";
import type {
  ActiveModeratorsPage,
  ChattersPage,
  ModerationFeedEvent,
  ModerationFeedStart,
  RewardRedemption,
} from "@shared/moderation-types";
import type { TwitchApiResult } from "@shared/twitch-api-types";

export interface WorkspaceChannel {
  id: string;
  login: string;
  displayName: string;
  isLive?: boolean;
}
export interface WorkspacePanelsPort {
  setSuspiciousStatus(
    channelId: string,
    actorId: string,
    userId: string,
    status: "ACTIVE_MONITORING" | "RESTRICTED" | "NO_TREATMENT"
  ): Promise<TwitchApiResult>;
  decideRedemption(
    channelId: string,
    rewardId: string,
    redemptionId: string,
    status: "FULFILLED" | "CANCELED"
  ): Promise<TwitchApiResult>;
  tokenStatus(): Promise<TokenStatusResult>;
  startFeed(params: ModerationFeedStart): Promise<TwitchApiResult>;
  stopFeed(feedId: string): Promise<boolean>;
  onEvent(callback: (event: { feedId: string; payload: ModerationFeedEvent }) => void): () => void;
  onState(callback: (event: { feedId: string; state: string }) => void): () => void;
  chatters(
    channelId: string,
    actorId: string,
    after?: string
  ): Promise<TwitchApiResult<ChattersPage>>;
  activeModerators(
    channelId: string,
    actorId: string,
    after?: string
  ): Promise<TwitchApiResult<ActiveModeratorsPage>>;
  rewards(
    channelId: string
  ): Promise<TwitchApiResult<{ items: { id: string; title: string; cost: number }[] }>>;
  redemptions(
    channelId: string,
    rewardId: string,
    after?: string
  ): Promise<TwitchApiResult<{ items: RewardRedemption[]; cursor: string | null }>>;
  moderatedChannels(userId: string): Promise<WorkspaceChannel[]>;
  followedChannels(): Promise<WorkspaceChannel[]>;
  openTwitch(channelName: string): Promise<void>;
}
