import type { StreamInfo, StreamInfoUpdate } from "@shared/moderation-types";

export type { StreamInfo, StreamInfoUpdate } from "@shared/moderation-types";

export type ChannelTool =
  | "bans"
  | "unban"
  | "moderators"
  | "vips"
  | "polls"
  | "predictions"
  | "shield"
  | "automod-settings"
  | "blocked-terms"
  | "stream-info";
export interface ToolAccess {
  canRead: boolean;
  canManage: boolean;
  broadcasterOnly: boolean;
  missingReadScopes: string[];
  missingWriteScopes: string[];
}
export type ChannelToolAccess = Record<ChannelTool, ToolAccess>;
export interface EngagementItem {
  id: string;
  title: string;
  status: string;
  options: Array<{ id: string; title: string; score: number }>;
}
export const autoModCategories = [
  "aggression",
  "bullying",
  "disability",
  "misogyny",
  "raceEthnicityOrReligion",
  "sexBasedTerms",
  "sexualitySexOrGender",
  "swearing",
] as const;
export type AutoModCategory = (typeof autoModCategories)[number];
export interface AutoModPolicy {
  level: number | null;
  categories: Record<AutoModCategory, number>;
}
export interface BlockedTerm {
  id: string;
  text: string;
}
export interface ChannelTools {
  openNativeView(channel: string): Promise<void>;
  streamInfo: {
    get(channelId: string): Promise<StreamInfo>;
    update(channelId: string, settings: StreamInfoUpdate): Promise<void>;
    searchCategories(query: string): Promise<Array<{ id: string; name: string }>>;
  };
  engagement: {
    list(kind: "polls" | "predictions", channelId: string): Promise<EngagementItem[]>;
    create(
      kind: "polls" | "predictions",
      channelId: string,
      title: string,
      options: string[],
      duration: number
    ): Promise<void>;
    end(
      kind: "polls" | "predictions",
      channelId: string,
      id: string,
      action: "TERMINATED" | "ARCHIVED" | "LOCKED" | "RESOLVED" | "CANCELED",
      winnerId?: string
    ): Promise<void>;
  };
  shield: {
    get(channelId: string, actorId: string): Promise<boolean>;
    set(channelId: string, actorId: string, active: boolean): Promise<void>;
  };
  autoMod: {
    get(channelId: string, actorId: string): Promise<AutoModPolicy>;
    set(channelId: string, actorId: string, policy: AutoModPolicy): Promise<void>;
  };
  terms: {
    list(
      channelId: string,
      actorId: string,
      cursor?: string
    ): Promise<{ terms: BlockedTerm[]; cursor?: string }>;
    add(channelId: string, actorId: string, text: string): Promise<void>;
    remove(channelId: string, actorId: string, id: string): Promise<void>;
  };
}
