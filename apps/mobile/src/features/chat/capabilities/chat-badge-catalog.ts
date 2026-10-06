import type { WatchChatBadge, WatchChatConnectInput } from "./watch-chat";

export type WatchChatBadgeCatalog = ReadonlyMap<
  string,
  ReadonlyMap<string, WatchChatBadge>
>;

export interface WatchChatBadgeCatalogReader {
  read(target: WatchChatConnectInput): Promise<WatchChatBadgeCatalog>;
  dispose?(): void;
}
