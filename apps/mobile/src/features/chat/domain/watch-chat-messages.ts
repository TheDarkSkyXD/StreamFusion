import type { WatchChatMessage } from "../capabilities/watch-chat";

const MAX_MESSAGES = 100;

export function appendWatchChatMessage(
  messages: readonly WatchChatMessage[],
  next: WatchChatMessage,
): readonly WatchChatMessage[] {
  const combined = [...messages, next];
  return combined.length > MAX_MESSAGES ? combined.slice(-MAX_MESSAGES) : combined;
}

export function parseTwitchPrivmsg(line: string): WatchChatMessage | null {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed.includes(" PRIVMSG ")) return null;
  const text = trimmed.split(" :").at(-1) ?? "";
  if (text === "") return null;
  const id = tagValue(trimmed, "id") || `twitch:${text}:${trimmed.length}`;
  const displayName =
    tagValue(trimmed, "display-name") ||
    /:([a-zA-Z0-9_]+)!/.exec(trimmed)?.[1] ||
    "chat";
  return { displayName, id, text };
}

export function parseKickChatFrame(
  payload: unknown,
): WatchChatMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const sender =
    typeof record.sender === "object" && record.sender !== null
      ? (record.sender as Record<string, unknown>)
      : {};
  const text = typeof record.content === "string" ? record.content : "";
  if (text === "") return null;
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.id === "number"
        ? `${record.id}`
        : `kick:${text}`;
  const displayName =
    (typeof sender.username === "string" && sender.username) ||
    (typeof sender.slug === "string" && sender.slug) ||
    "chat";
  return { displayName, id, text };
}

function tagValue(line: string, key: string): string {
  const match = new RegExp(`(?:^@|;)${key}=([^; ]*)`).exec(line);
  return match?.[1] ?? "";
}
