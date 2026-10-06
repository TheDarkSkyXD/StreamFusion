import type { TimestampFormat } from "@mobile/features/settings/capabilities/chat-display-settings";
import type { WatchChatMessage } from "../capabilities/watch-chat";

export function formatMessageTimestamp(
  message: WatchChatMessage,
  format: TimestampFormat,
): string | null {
  const pad = (value: number) => String(value).padStart(2, "0");
  if (message.offsetSeconds !== undefined) {
    const seconds = Math.max(0, Math.floor(message.offsetSeconds));
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  }
  if (message.receivedAt === undefined) return null;
  const date = new Date(message.receivedAt);
  const hour = date.getHours();
  const twelveHour = format.includes("a");
  const hours = twelveHour ? hour % 12 || 12 : hour;
  const padded = format.startsWith("HH") || format.startsWith("hh");
  return `${padded ? pad(hours) : hours}:${pad(date.getMinutes())}${format.includes("ss") ? `:${pad(date.getSeconds())}` : ""}${twelveHour ? ` ${hour >= 12 ? "PM" : "AM"}` : ""}`;
}
