import type {
  WatchChatEvent,
  WatchChatMessage,
} from "../capabilities/watch-chat";

export type WatchChatModerationEvent = Exclude<
  WatchChatEvent,
  { readonly kind: "message" }
>;

export function applyWatchChatModeration(
  messages: readonly WatchChatMessage[],
  event: WatchChatModerationEvent,
): readonly WatchChatMessage[] {
  if (event.kind === "clear-room") return [];
  return messages.map((message) => {
    if (message.kind === "notice" || message.deletedAt !== undefined)
      return message;
    const matches =
      event.kind === "delete"
        ? message.id === event.messageId
        : (event.userId !== undefined && message.userId === event.userId) ||
          (event.username !== undefined &&
            message.username?.toLowerCase() === event.username.toLowerCase());
    if (!matches) return message;
    return {
      ...message,
      deletedAt: event.at,
      deletionKind:
        event.kind === "delete"
          ? "message"
          : event.durationSeconds === undefined
            ? "ban"
            : "timeout",
      ...(event.actor ? { deletedBy: event.actor } : {}),
    };
  });
}
