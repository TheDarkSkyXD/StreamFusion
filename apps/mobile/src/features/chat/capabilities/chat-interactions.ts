import type { WatchChatConnectInput, WatchChatMessage } from "./watch-chat";

export type ChatEmote = {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string;
  readonly insertion: string;
  readonly provider: "twitch" | "kick" | "7tv" | "bttv" | "ffz";
};

export type ChatCommandResult =
  | { readonly kind: "sent"; readonly messageId: string }
  | { readonly kind: "completed" }
  | {
      readonly kind: "blocked" | "failed" | "uncertain";
      readonly detail: string;
    };

export type ChatInteractionView = {
  readonly access: "checking" | "ready" | "blocked";
  readonly detail: string;
  readonly sending: boolean;
  readonly emotes: readonly ChatEmote[];
  readonly emoteStatus: "loading" | "ready" | "partial" | "failed";
  readonly emoteDetail: string;
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
  send(text: string, replyId?: string): Promise<ChatCommandResult>;
  userAction(
    message: WatchChatMessage,
    action: "block" | "report",
  ): Promise<ChatCommandResult>;
  dispose(): void;
}
