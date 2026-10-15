import type { WatchChatMessage } from "../capabilities/watch-chat";

export function selectUserChatMessages(
  selected: WatchChatMessage,
  messages: readonly WatchChatMessage[],
): readonly WatchChatMessage[] {
  const login = selected.username?.toLowerCase();
  const matches = messages.filter((message) => {
    if (selected.userId && message.userId)
      return selected.userId === message.userId;
    if (!login || !message.username) return false;
    return message.username.toLowerCase() === login;
  });
  const recent = matches.slice(-20);
  if (recent.some((message) => message.id === selected.id)) return recent;
  return [selected, ...recent];
}
