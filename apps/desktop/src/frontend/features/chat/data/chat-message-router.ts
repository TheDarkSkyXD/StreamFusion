import { kickChatService } from "@backend/services/chat/kick-chat";
import { substituteThirdPartyEmotes } from "@backend/services/chat/third-party-emote-enrich";
import { twitchChatService } from "@backend/services/chat/twitch-chat";
import type { ChatMessage } from "@shared/chat-types";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import { buildChannelKey, useChatStore } from "@/store/chat-store";
import { useEmoteStore } from "@/store/emote-store";

interface MessageRoute {
  readonly channelKey: string;
  readonly platform: ChatPlatform;
  emoteChannelId?: string;
  references: number;
}

const routes = new Map<string, MessageRoute>();
const platformReferences: Record<ChatPlatform, number> = { twitch: 0, kick: 0 };

function routeMessage(message: ChatMessage): void {
  const channelKey = buildChannelKey(message.platform, message.channel);
  const route = routes.get(channelKey);
  if (!route) return;

  const emoteMap = useEmoteStore.getState().getEmoteNameMap(route.emoteChannelId);
  const content = substituteThirdPartyEmotes(message.content, emoteMap, {
    includeNative: message.platform === "twitch",
  });
  const enriched = content === message.content ? message : { ...message, content };
  useChatStore.getState().addMessageBatched(enriched, channelKey);
}

function attachPlatform(platform: ChatPlatform): void {
  if (platform === "twitch") twitchChatService.on("message", routeMessage);
  else kickChatService.on("message", routeMessage);
}

function detachPlatform(platform: ChatPlatform): void {
  if (platform === "twitch") twitchChatService.off("message", routeMessage);
  else kickChatService.off("message", routeMessage);
}

export function registerChatMessageRoute(input: {
  platform: ChatPlatform;
  channel: string;
  emoteChannelId?: string;
}): () => void {
  const channelKey = buildChannelKey(input.platform, input.channel);
  const existing = routes.get(channelKey);
  if (existing) {
    existing.references += 1;
    if (input.emoteChannelId) existing.emoteChannelId = input.emoteChannelId;
  } else {
    routes.set(channelKey, {
      channelKey,
      platform: input.platform,
      emoteChannelId: input.emoteChannelId,
      references: 1,
    });
  }

  if (platformReferences[input.platform] === 0) attachPlatform(input.platform);
  platformReferences[input.platform] += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const route = routes.get(channelKey);
    if (route?.references === 1) routes.delete(channelKey);
    else if (route) route.references -= 1;

    platformReferences[input.platform] = Math.max(0, platformReferences[input.platform] - 1);
    if (platformReferences[input.platform] === 0) detachPlatform(input.platform);
  };
}
