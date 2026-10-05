import type {
  WatchChatAvailability,
  WatchChatSession,
} from "@mobile/features/chat/capabilities/watch-chat";
import type { MultistreamTile } from "./multistream";

export interface MultistreamChat {
  attach(tiles: readonly MultistreamTile[]): void;
  snapshot(channelId: string | null): WatchChatAvailability;
  subscribe(listener: () => void): () => void;
  retry(channelId: string | null): void;
  dispose(): void;
}
export type MultistreamChatFactory = () => WatchChatSession;
