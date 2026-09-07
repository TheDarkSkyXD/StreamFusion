import type { ChatMessage } from "@shared/chat-types";

export interface UserMessageTarget {
  userId: string;
  username: string;
}

function isAuthoredBy(message: ChatMessage, target: UserMessageTarget): boolean {
  if (message.userId && target.userId) return message.userId === target.userId;
  return message.username.toLowerCase() === target.username.toLowerCase();
}

function isReplyTo(message: ChatMessage, target: UserMessageTarget): boolean {
  if (!message.replyTo) return false;
  if (message.replyTo.parentUserId && target.userId) {
    return message.replyTo.parentUserId === target.userId;
  }
  if (message.replyTo.parentUserId) return false;
  return message.replyTo.parentUsername.toLowerCase() === target.username.toLowerCase();
}

export function selectRecentUserMessages(
  messagesByChannel: Readonly<Record<string, readonly ChatMessage[]>>,
  channelKey: string,
  target: UserMessageTarget,
  limit = 10
): ChatMessage[] {
  return (messagesByChannel[channelKey] ?? [])
    .filter(
      (message) =>
        message.type === "message" && (isAuthoredBy(message, target) || isReplyTo(message, target))
    )
    .slice(-limit);
}

export function selectLatestAuthoredMessage(
  messagesByChannel: Readonly<Record<string, readonly ChatMessage[]>>,
  channelKey: string,
  target: UserMessageTarget
): ChatMessage | null {
  const messages = messagesByChannel[channelKey] ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === "message" && isAuthoredBy(message, target)) return message;
  }
  return null;
}

export function reconcileSelectedMessage(
  selectedSnapshot: ChatMessage | null,
  liveCollection: readonly ChatMessage[]
): ChatMessage | null {
  if (!selectedSnapshot) return null;
  return (
    liveCollection.find(
      (message) =>
        message.id === selectedSnapshot.id &&
        message.platform === selectedSnapshot.platform &&
        message.channel === selectedSnapshot.channel &&
        message.userId === selectedSnapshot.userId
    ) ?? selectedSnapshot
  );
}
