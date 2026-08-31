import type { ChatMessage, ChatPlatform } from "@shared/chat-types";
import { buildChannelKey } from "@/store/chat-store";

export interface MultiChatChannel {
  readonly key: string;
  readonly platform: ChatPlatform;
  readonly channel: string;
  readonly label: string;
}

export interface MergedChatMessage {
  readonly key: string;
  readonly channelKey: string;
  readonly channelLabel: string;
  readonly message: ChatMessage;
}

export function createMultiChatChannel(
  platform: ChatPlatform,
  channel: string,
  label = channel
): MultiChatChannel {
  const normalizedChannel = channel.trim().replace(/^#/, "").toLowerCase();
  return {
    key: buildChannelKey(platform, normalizedChannel),
    platform,
    channel: normalizedChannel,
    label: label.trim() || normalizedChannel,
  };
}

export function dedupeMultiChatChannels(channels: readonly MultiChatChannel[]): MultiChatChannel[] {
  const seen = new Set<string>();
  return channels.filter((channel) => {
    if (seen.has(channel.key)) return false;
    seen.add(channel.key);
    return true;
  });
}

export function mergeChatMessageBuckets(
  channels: readonly MultiChatChannel[],
  messagesByChannel: Readonly<Record<string, readonly ChatMessage[]>>
): MergedChatMessage[] {
  interface HeapEntry {
    channelIndex: number;
    messageIndex: number;
    timestamp: number;
  }

  const compare = (left: HeapEntry, right: HeapEntry) =>
    left.timestamp - right.timestamp ||
    left.channelIndex - right.channelIndex ||
    left.messageIndex - right.messageIndex;
  const heap: HeapEntry[] = [];
  const push = (entry: HeapEntry) => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(heap[parent], entry) <= 0) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = entry;
  };
  const pop = (): HeapEntry | undefined => {
    const first = heap[0];
    const last = heap.pop();
    if (!first || !last || heap.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const child = right < heap.length && compare(heap[right], heap[left]) < 0 ? right : left;
      if (compare(last, heap[child]) <= 0) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return first;
  };

  channels.forEach((channel, channelIndex) => {
    const first = messagesByChannel[channel.key]?.[0];
    if (first) push({ channelIndex, messageIndex: 0, timestamp: first.timestamp.getTime() });
  });

  const result: MergedChatMessage[] = [];
  for (let entry = pop(); entry; entry = pop()) {
    const channel = channels[entry.channelIndex];
    const message = messagesByChannel[channel.key]?.[entry.messageIndex];
    if (!message) continue;

    result.push({
      key: `${channel.key}:${message.id}`,
      channelKey: channel.key,
      channelLabel: channel.label,
      message,
    });

    const messageIndex = entry.messageIndex + 1;
    const next = messagesByChannel[channel.key]?.[messageIndex];
    if (next) {
      push({ channelIndex: entry.channelIndex, messageIndex, timestamp: next.timestamp.getTime() });
    }
  }

  return result;
}
