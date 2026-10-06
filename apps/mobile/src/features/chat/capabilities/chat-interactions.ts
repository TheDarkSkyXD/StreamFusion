import type { WatchChatConnectInput, WatchChatMessage } from "./watch-chat";
import type { ChatDisplayPreferences } from "@mobile/features/settings/capabilities/chat-display-settings";

export type ChatEmote = {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string;
  readonly insertion: string;
  readonly provider: "twitch" | "kick" | "7tv" | "bttv" | "ffz";
  readonly staticImageUrl?: string;
  readonly animatedImageUrl?: string;
  readonly zeroWidth?: boolean;
};

export type ChatCosmeticBadge = {
  readonly id: string;
  readonly provider: "7tv" | "bttv" | "ffz";
  readonly title: string;
  readonly imageUrl: string;
  readonly slot?: number;
  readonly replaces?: string;
  readonly color?: string;
};

export type ChatPaintStop = { readonly at: number; readonly color: string };
export type ChatPaintShadow = {
  readonly xOffset: number;
  readonly yOffset: number;
  readonly radius: number;
  readonly color: string;
};
export type ChatPaintLayer =
  | {
      readonly kind: "linear" | "radial";
      readonly opacity: number;
      readonly stops: readonly ChatPaintStop[];
      readonly angle?: number;
      readonly shape?: "circle" | "ellipse";
      readonly repeat?: boolean;
    }
  | {
      readonly kind: "image";
      readonly opacity: number;
      readonly imageUrl: string;
    };
export type ChatUsernamePaint =
  | {
      readonly kind: "layers";
      readonly id: string;
      readonly layers: readonly ChatPaintLayer[];
      readonly shadows: readonly ChatPaintShadow[];
    }
  | {
      readonly kind: "linear" | "radial";
      readonly id: string;
      readonly stops: readonly ChatPaintStop[];
      readonly shadows: readonly ChatPaintShadow[];
      readonly angle?: number;
      readonly shape?: "circle" | "ellipse";
      readonly repeat?: boolean;
    }
  | {
      readonly kind: "image";
      readonly id: string;
      readonly imageUrl: string;
      readonly shadows: readonly ChatPaintShadow[];
    };

export type ChatUserCosmetics = {
  readonly badges: readonly ChatCosmeticBadge[];
  readonly paint?: ChatUsernamePaint;
};

export type ChatCosmeticRoleBadges = readonly ChatCosmeticBadge[];

export interface ChatCosmeticsReader {
  read(
    target: WatchChatConnectInput,
    userIds: readonly string[],
    signal: AbortSignal,
  ): Promise<{
    readonly byUserId: ReadonlyMap<string, ChatUserCosmetics>;
    readonly roleBadges?: ChatCosmeticRoleBadges;
    readonly failures: readonly string[];
  }>;
}

export type ChatCommandResult =
  | { readonly kind: "sent"; readonly messageId: string }
  | { readonly kind: "completed" }
  | {
      readonly kind: "blocked" | "failed" | "uncertain";
      readonly detail: string;
    };

export type ChatInteractionView = {
  readonly displayPreferences?: ChatDisplayPreferences;
  readonly access: "checking" | "ready" | "blocked";
  readonly detail: string;
  readonly sending: boolean;
  readonly emotes: readonly ChatEmote[];
  readonly emoteStatus: "loading" | "ready" | "partial" | "failed";
  readonly emoteDetail: string;
  readonly cosmetics?: ReadonlyMap<string, ChatUserCosmetics>;
  readonly cosmeticRoleBadges?: ChatCosmeticRoleBadges;
  readonly cosmeticsDetail?: string;
};

export interface ChatCommands {
  access(
    target: WatchChatConnectInput,
  ): Promise<{ readonly allowed: boolean; readonly detail: string }>;
  subscribe(listener: () => void): () => void;
  send(
    target: WatchChatConnectInput,
    text: string,
    replyId: string | null,
    signal: AbortSignal,
  ): Promise<ChatCommandResult>;
  userAction(
    target: WatchChatConnectInput,
    message: WatchChatMessage,
    action: "block" | "report",
    signal: AbortSignal,
  ): Promise<ChatCommandResult>;
}

export interface ChatEmoteReader {
  read(
    target: WatchChatConnectInput,
    signal: AbortSignal,
  ): Promise<{
    readonly emotes: readonly ChatEmote[];
    readonly failures: readonly string[];
  }>;
}

export interface ChatInteractions {
  attach(target: WatchChatConnectInput, recorded: boolean): void;
  snapshot(): ChatInteractionView;
  subscribe(listener: () => void): () => void;
  loadCosmetics?(userIds: readonly string[]): void;
  send(text: string, replyId?: string): Promise<ChatCommandResult>;
  userAction(
    message: WatchChatMessage,
    action: "block" | "report",
  ): Promise<ChatCommandResult>;
  dispose(): void;
}
