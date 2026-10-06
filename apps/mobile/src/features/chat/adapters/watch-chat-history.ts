import type {
  WatchChatConnectInput,
  WatchChatMessage,
} from "../capabilities/watch-chat";
import { kickPublicChannelUrl } from "@mobile/features/discovery/adapters/kick/kick-public-catalog";
import { parseTwitchChatEvent } from "../domain/watch-chat-events";
import { parseKickChatFrame } from "../domain/watch-chat-messages";
import { getBundledBadgeUrl } from "../utils/kick-badge-assets";

export type WatchChatHistoryResult =
  | { readonly kind: "loaded"; readonly messages: readonly WatchChatMessage[] }
  | { readonly kind: "unavailable"; readonly detail: string };

export async function readWatchChatHistory(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly target: WatchChatConnectInput;
  readonly limit: number;
  readonly signal: AbortSignal;
}): Promise<WatchChatHistoryResult> {
  const limit = Math.min(800, Math.max(1, Math.floor(input.limit)));
  if (!Number.isFinite(limit) || input.signal.aborted)
    return unavailable(input.target);
  try {
    if (input.target.platform === "twitch") {
      const channel = input.target.channelName
        .trim()
        .replace(/^#/, "")
        .toLowerCase();
      if (!/^[a-z0-9_]+$/.test(channel)) return unavailable(input.target);
      const url = `https://recent-messages.robotty.de/api/v2/recent-messages/${encodeURIComponent(channel)}?limit=${limit}&hide_moderation_messages=true&hide_moderated_messages=true`;
      const response = await input.fetch(url, { signal: input.signal });
      if (!response.ok) return unavailable(input.target);
      const body: unknown = await response.json();
      const raw = property(body, "messages");
      if (!Array.isArray(raw)) return unavailable(input.target);
      return {
        kind: "loaded",
        messages: raw
          .flatMap((line) => {
            if (typeof line !== "string") return [];
            const event = parseTwitchChatEvent(line);
            return event?.kind === "message"
              ? [{ ...event.message, isHistorical: true }]
              : [];
          })
          .slice(-limit),
      };
    }
    let channelId = input.target.channelId;
    if (!/^\d+$/.test(channelId)) {
      const channelResponse = await input.fetch(
        kickPublicChannelUrl(input.target.channelName),
        { headers: { Accept: "application/json" }, signal: input.signal },
      );
      if (!channelResponse.ok) return unavailable(input.target);
      const channel: unknown = await channelResponse.json();
      const publicId = property(channel, "id");
      channelId =
        typeof publicId === "number" || typeof publicId === "string"
          ? String(publicId)
          : "";
    }
    if (!/^\d+$/.test(channelId)) return unavailable(input.target);
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(channelId)}/messages`;
    const response = await input.fetch(url, {
      headers: { Accept: "application/json" },
      signal: input.signal,
    });
    if (!response.ok) return unavailable(input.target);
    const body: unknown = await response.json();
    const raw = property(property(body, "data"), "messages");
    if (!Array.isArray(raw)) return unavailable(input.target);
    return {
      kind: "loaded",
      messages: raw
        .slice(0, limit)
        .reverse()
        .flatMap((item) => {
          const parsed = parseKickChatFrame(item, getBundledBadgeUrl);
          return parsed ? [{ ...parsed, isHistorical: true }] : [];
        }),
    };
  } catch {
    return unavailable(input.target);
  }
}

function unavailable(target: WatchChatConnectInput): WatchChatHistoryResult {
  return {
    kind: "unavailable",
    detail:
      target.platform === "twitch"
        ? "Recent Twitch chat could not be loaded. Live chat is connected."
        : "Recent Kick chat could not be loaded. Live chat is connected.",
  };
}

function property(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return Reflect.get(value, key);
}
