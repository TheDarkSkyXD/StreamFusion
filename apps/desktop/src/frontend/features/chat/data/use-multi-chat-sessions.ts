import { useQueries } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { kickChatService } from "@backend/services/chat/kick-chat";
import { twitchChatService } from "@backend/services/chat/twitch-chat";
import {
  ensureEmoteProvidersInitialized,
  initializeKickEmotes,
  initializeTwitchEmotes,
} from "@backend/services/emotes";
import type { UnifiedChannel } from "@shared/platform-types";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useEmoteStore } from "@/store/emote-store";
import { channelByUsernameQueryOptions } from "../../discovery/data/queries/useChannels";
import { logger } from "@/renderer/logging/logger";
import type { MultiChatChannel } from "./multi-chat-feed";
import { registerChatMessageRoute } from "./chat-message-router";

interface ResolvedMultiChatChannel {
  readonly chat: MultiChatChannel;
  readonly channel: UnifiedChannel;
}

export function useMultiChatSessions(
  channels: readonly MultiChatChannel[],
  enabled: boolean
): { isLoading: boolean; failedChannels: readonly string[] } {
  const [failedSessionKeys, setFailedSessionKeys] = useState<readonly string[]>([]);
  const queries = useQueries({
    queries: channels.map((channel) => ({
      ...channelByUsernameQueryOptions(channel.channel, channel.platform),
      enabled: enabled && channel.channel.length > 0,
    })),
  });
  const resolved = channels.flatMap<ResolvedMultiChatChannel>((chat, index) => {
    const channel = queries[index]?.data;
    return channel ? [{ chat, channel }] : [];
  });
  const resolvedRef = useRef(resolved);
  useLayoutEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);
  const sessionSignature = resolved
    .map(({ chat, channel }) =>
      [chat.key, channel.id, channel.chatroomId ?? "", channel.kickUserId ?? ""].join(":")
    )
    .join("|");

  useEffect(() => {
    if (!enabled || resolvedRef.current.length === 0) {
      setFailedSessionKeys([]);
      return;
    }
    setFailedSessionKeys([]);
    let cancelled = false;
    const sessions = resolvedRef.current;
    const unregisterRoutes = sessions.map(({ chat, channel }) =>
      registerChatMessageRoute({
        platform: chat.platform,
        channel: chat.channel,
        emoteChannelId:
          chat.platform === "kick" ? String(channel.chatroomId ?? chat.channel) : channel.id,
      })
    );

    for (const { chat } of sessions) {
      if (chat.platform === "twitch") twitchChatService.acquire(chat.channel);
      else kickChatService.acquire(chat.channel);
    }

    const start = async () => {
      ensureEmoteProvidersInitialized();
      const emotes = useEmoteStore.getState();
      emotes.applyProviderPrefs(
        useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES
      );

      const twitchSessions = sessions.filter(({ chat }) => chat.platform === "twitch");
      const kickSessions = sessions.filter(({ chat }) => chat.platform === "kick");

      const markFailed = (keys: readonly string[]) => {
        if (cancelled || keys.length === 0) return;
        setFailedSessionKeys((current) => [...new Set([...current, ...keys])]);
      };

      const startTwitch = async () => {
        if (twitchSessions.length === 0) return;
        try {
          const [accessToken, twitchUser] = await Promise.all([
            window.electronAPI.auth.getValidTwitchToken(),
            window.electronAPI.auth.getTwitchUser(),
          ]);
          await twitchChatService.connect(
            accessToken && twitchUser
              ? {
                  accessToken,
                  user: twitchUser,
                  tokenFetcher: () => window.electronAPI.auth.getValidTwitchToken(),
                }
              : { anonymous: true, debug: import.meta.env.DEV }
          );
          await Promise.all([initializeTwitchEmotes(), emotes.loadGlobalEmotes("twitch")]);
          if (cancelled) return;
          const results = await Promise.allSettled(
            twitchSessions.map(async ({ chat, channel }) => {
              await Promise.all([
                twitchChatService.joinChannel(chat.channel, channel.id),
                emotes.loadChannelEmotes(channel.id, chat.channel, "twitch"),
              ]);
            })
          );
          markFailed(
            twitchSessions.flatMap(({ chat }, index) =>
              results[index]?.status === "rejected" ? [chat.key] : []
            )
          );
        } catch (error) {
          logger.error("UI:Chat:MultiView", "failed to start Twitch multi-chat sessions", {
            error: error instanceof Error ? error.message : String(error),
          });
          markFailed(twitchSessions.map(({ chat }) => chat.key));
        }
      };

      const startKick = async () => {
        if (kickSessions.length === 0) return;
        try {
          const token = await window.electronAPI.auth.getToken("kick");
          await kickChatService.connect({ debug: import.meta.env.DEV });
          if (token) initializeKickEmotes(token.accessToken);
          await emotes.loadGlobalEmotes("kick");
          if (cancelled) return;
          const results = await Promise.allSettled(
            kickSessions.map(async ({ chat, channel }) => {
              if (!channel.chatroomId) {
                throw new Error(`Kick chatroom is unavailable for ${chat.channel}`);
              }
              const broadcasterId = Number(channel.id);
              await Promise.all([
                kickChatService.joinChannel(
                  chat.channel,
                  channel.chatroomId,
                  Number.isFinite(broadcasterId) ? broadcasterId : undefined
                ),
                emotes.loadChannelEmotes(
                  String(channel.chatroomId),
                  chat.channel,
                  "kick",
                  channel.kickUserId
                ),
              ]);
            })
          );
          markFailed(
            kickSessions.flatMap(({ chat }, index) =>
              results[index]?.status === "rejected" ? [chat.key] : []
            )
          );
        } catch (error) {
          logger.error("UI:Chat:MultiView", "failed to start Kick multi-chat sessions", {
            error: error instanceof Error ? error.message : String(error),
          });
          markFailed(kickSessions.map(({ chat }) => chat.key));
        }
      };

      await Promise.all([startTwitch(), startKick()]);
    };

    void start();

    return () => {
      cancelled = true;
      unregisterRoutes.forEach((unregister) => unregister());
      for (const { chat } of sessions) {
        if (chat.platform === "twitch") void twitchChatService.release(chat.channel);
        else void kickChatService.release(chat.channel);
      }
    };
  }, [enabled, sessionSignature]);

  return useMemo(
    () => ({
      isLoading: enabled && queries.some((query) => query.isLoading),
      failedChannels: [
        ...new Set([
          ...failedSessionKeys,
          ...channels
            .filter((_channel, index) => queries[index]?.isError)
            .map((channel) => channel.key),
        ]),
      ],
    }),
    [channels, enabled, failedSessionKeys, queries]
  );
}
