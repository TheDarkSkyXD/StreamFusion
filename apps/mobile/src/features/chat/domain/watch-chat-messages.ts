import type { WatchChatBadge, WatchChatMessage } from "../capabilities/watch-chat";
import { resolveTwitchBadges } from "./twitch-global-badge-catalog";

const MAX_MESSAGES = 100;

/** Role / status badge sets we always surface when present on IRC tags. */
const PRIORITY_BADGE_SET_IDS = new Set([
  "broadcaster",
  "moderator",
  "lead_moderator",
  "vip",
  "subscriber",
  "founder",
]);

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
  const badgeRefs = parseIrcBadgesTag(tagValue(trimmed, "badges"));
  const badges = resolveTwitchBadges(badgeRefs);
  return { badges, displayName, id, text };
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
  return { badges: [], displayName, id, text };
}

export function parseIrcBadgesTag(raw: string): readonly {
  readonly setId: string;
  readonly version: string;
}[] {
  if (!raw) return [];
  const badges: Array<{ setId: string; version: string }> = [];
  for (const part of raw.split(",")) {
    if (!part) continue;
    const slash = part.indexOf("/");
    if (slash <= 0) continue;
    const setId = part.slice(0, slash);
    const version = part.slice(slash + 1);
    if (!setId || !version) continue;
    badges.push({ setId, version });
  }
  // Prefer role badges first so compact rows still show lead_moderator/mod.
  return badges.sort((left, right) => {
    const leftPriority = PRIORITY_BADGE_SET_IDS.has(left.setId) ? 0 : 1;
    const rightPriority = PRIORITY_BADGE_SET_IDS.has(right.setId) ? 0 : 1;
    return leftPriority - rightPriority;
  });
}

function tagValue(line: string, key: string): string {
  const match = new RegExp(`(?:^@|;)${key}=([^; ]*)`).exec(line);
  return match?.[1] ?? "";
}

export type { WatchChatBadge };
