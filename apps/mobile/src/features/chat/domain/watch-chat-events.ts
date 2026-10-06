import type {
  WatchChatEvent,
  WatchChatMessage,
} from "../capabilities/watch-chat";
import { parseTwitchPrivmsg } from "./watch-chat-messages";

export function parseTwitchChatEvent(line: string): WatchChatEvent | null {
  const chat = parseTwitchPrivmsg(line);
  if (chat) return { kind: "message", message: chat };
  const command =
    /(?:^| )(?<command>USERNOTICE|NOTICE|CLEARMSG|CLEARCHAT) #[^ ]+/.exec(line)
      ?.groups?.command;
  if (!command) return null;
  const at = timestamp(line);
  if (command === "CLEARMSG") {
    const messageId = ircTag(line, "target-msg-id");
    return messageId ? { kind: "delete", messageId, at } : null;
  }
  if (command === "CLEARCHAT") {
    const username = / CLEARCHAT #[^ ]+ :([^ ]+)/.exec(line)?.[1];
    if (!username) return { kind: "clear-room", at };
    const userId = ircTag(line, "target-user-id");
    const duration = Number(ircTag(line, "ban-duration"));
    return {
      kind: "clear-user",
      username,
      ...(userId ? { userId } : {}),
      at,
      ...(Number.isFinite(duration) && duration > 0
        ? { durationSeconds: duration }
        : {}),
    };
  }
  const raw =
    command === "USERNOTICE"
      ? ircTag(line, "system-msg")
      : (/ NOTICE #[^ ]+ :(.*)$/.exec(line)?.[1] ?? "");
  const text = unescapeIrc(raw);
  if (!text) return null;
  const msgId = ircTag(line, "msg-id");
  const noticeKind =
    msgId === "sub"
      ? "subscription"
      : msgId === "resub"
        ? "resub"
        : msgId === "subgift" ||
            msgId === "anonsubgift" ||
            msgId === "submysterygift" ||
            msgId === "anonsubmysterygift"
          ? "gift"
          : msgId === "raid" || msgId === "unraid"
            ? "raid"
            : "system";
  const username = ircTag(line, "login") || "system";
  const displayName = unescapeIrc(ircTag(line, "display-name")) || username;
  const message: WatchChatMessage = {
    id: ircTag(line, "id") || `twitch:notice:${at}:${text}`,
    displayName,
    username,
    text,
    badges: [],
    receivedAt: at,
    kind: "notice",
    noticeKind,
  };
  return { kind: "message", message };
}

export function parseKickChatEvent(
  event: string,
  payload: unknown,
): WatchChatEvent | null {
  const data = record(payload);
  if (!data) return null;
  const at =
    typeof data.created_at === "string" &&
    Number.isFinite(Date.parse(data.created_at))
      ? Date.parse(data.created_at)
      : Date.now();
  if (event === "App\\Events\\MessageDeletedEvent") {
    const message = record(data.message);
    const messageId = stringId(message?.id);
    if (!messageId) return null;
    const actorFields = [
      "deleted_by",
      "deletedBy",
      "moderator",
      "actor",
      "bot",
      "automod",
      "auto_mod",
      "automation",
      "source",
    ] as const;
    const actor =
      actorFields.map((key) => actorName(data[key])).find(Boolean) ??
      actorFields.map((key) => actorName(message?.[key])).find(Boolean);
    return { kind: "delete", messageId, at, ...(actor ? { actor } : {}) };
  }
  if (event === "App\\Events\\ChatroomClearEvent")
    return { kind: "clear-room", at };
  if (event === "App\\Events\\UserBannedEvent") {
    const user = record(data.user);
    const userId = stringId(user?.id);
    const username =
      typeof user?.username === "string" ? user.username : undefined;
    if (!userId && !username) return null;
    const duration =
      typeof data.duration === "number" && data.duration > 0
        ? data.duration * 60
        : undefined;
    const actor = actorName(data.banned_by);
    return {
      kind: "clear-user",
      at,
      ...(userId ? { userId } : {}),
      ...(username ? { username } : {}),
      ...(duration && data.permanent !== true
        ? { durationSeconds: duration }
        : {}),
      ...(actor ? { actor } : {}),
    };
  }
  let text = "";
  let noticeKind: WatchChatMessage["noticeKind"] = "system";
  let username = "system";
  if (event === "App\\Events\\SubscriptionEvent") {
    if (typeof data.username !== "string") return null;
    username = data.username;
    const months = typeof data.months === "number" ? data.months : 1;
    noticeKind = months > 1 ? "resub" : "subscription";
    text =
      months > 1
        ? `${username} has resubscribed for ${months} months!`
        : `${username} subscribed!`;
  } else if (event === "App\\Events\\GiftedSubscriptionsEvent") {
    if (typeof data.gifter_username !== "string") return null;
    username = data.gifter_username;
    const gifted = Array.isArray(data.gifted_usernames)
      ? data.gifted_usernames.filter(
          (name): name is string => typeof name === "string",
        )
      : [];
    if (gifted.length === 0) return null;
    text =
      gifted.length === 1
        ? `${username} gifted a subscription to ${gifted[0]}!`
        : `${username} gifted ${gifted.length} subscriptions!`;
    noticeKind = "gift";
  } else if (event === "App\\Events\\StreamHostEvent") {
    if (typeof data.host_username !== "string") return null;
    username = data.host_username;
    const viewers =
      typeof data.number_viewers === "number" ? data.number_viewers : 0;
    text = `${username} is raiding with ${viewers} viewers!`;
    noticeKind = "raid";
  } else return null;
  return {
    kind: "message",
    message: {
      id: stringId(data.id) || `kick:notice:${at}:${text}`,
      displayName: username,
      username: username.toLowerCase(),
      text,
      badges: [],
      receivedAt: at,
      kind: "notice",
      noticeKind,
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringId(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function actorName(value: unknown): string | undefined {
  const actor = record(value);
  const candidates =
    typeof value === "string"
      ? [value]
      : actor
        ? [actor.username, actor.display_name, actor.name, actor.slug]
        : [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (!name) continue;
    if (/^auto[-_\s]?mod$/i.test(name)) return "AutoMod";
    if (/^bot$/i.test(name)) return "Bot";
    return name;
  }
  return undefined;
}

function timestamp(line: string): number {
  const value = Number(ircTag(line, "tmi-sent-ts"));
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

function ircTag(line: string, key: string): string {
  return new RegExp(`(?:^@|;)${key}=([^; ]*)`).exec(line)?.[1] ?? "";
}

function unescapeIrc(value: string): string {
  return value.replace(/\\([snr:\\])/g, (_match, code: string) => {
    if (code === "s") return " ";
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    return code === ":" ? ";" : "\\";
  });
}
