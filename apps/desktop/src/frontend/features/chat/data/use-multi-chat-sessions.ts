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

interface RetainedChatSession {
  readonly channelKey: string;
  readonly dispose: () => Promise<void>;
}

function sessionIdentity({ chat, channel }: ResolvedMultiChatChannel): string {
  return JSON.stringify([chat.key, channel.id, channel.chatroomId, channel.kickUserId]);
}

function retainChatSession(
  { chat, channel }: ResolvedMultiChatChannel,
  previousRelease: Promise<void> | undefined,
  reportFailure: (channelKey: string) => void
): RetainedChatSession {
  const cancellation = new AbortController();
  const service = chat.platform === "twitch" ? twitchChatService : kickChatService;
  const unregisterRoute = registerChatMessageRoute({
    platform: chat.platform,
    channel: chat.channel,
    emoteChannelId:
      chat.platform === "kick" ? String(channel.chatroomId ?? chat.channel) : channel.id,
  });
  let acquired = false;
  let joining: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;

  const startup = (async () => {
    try {
      await previousRelease;
      if (cancellation.signal.aborted) return;
      service.acquire(chat.channel);
      acquired = true;
      ensureEmoteProvidersInitialized();
      const emotes = useEmoteStore.getState();
      emotes.applyProviderPrefs(
        useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES
      );

      if (chat.platform === "twitch") {
        const [accessToken, twitchUser] = await Promise.all([
          window.electronAPI.auth.getValidTwitchToken(),
          window.electronAPI.auth.getTwitchUser(),
        ]);
        if (cancellation.signal.aborted) return;
        await twitchChatService.connect(
          accessToken && twitchUser
            ? {
                accessToken,
                user: twitchUser,
                tokenFetcher: () => window.electronAPI.auth.getValidTwitchToken(),
              }
            : { anonymous: true, debug: import.meta.env.DEV }
        );
        if (cancellation.signal.aborted) return;
        await Promise.all([initializeTwitchEmotes(), emotes.loadGlobalEmotes("twitch")]);
        if (cancellation.signal.aborted) return;
        joining = twitchChatService.joinChannel(chat.channel, channel.id);
        await Promise.all([joining, emotes.loadChannelEmotes(channel.id, chat.channel, "twitch")]);
      } else {
        const token = await window.electronAPI.auth.getToken("kick");
        if (cancellation.signal.aborted) return;
        await kickChatService.connect({ debug: import.meta.env.DEV });
        if (cancellation.signal.aborted) return;
        if (token) initializeKickEmotes(token.accessToken);
        await emotes.loadGlobalEmotes("kick");
        if (cancellation.signal.aborted) return;
        if (!channel.chatroomId) {
          throw new Error(`Kick chatroom is unavailable for ${chat.channel}`);
        }
        const broadcasterId = Number(channel.id);
        joining = kickChatService.joinChannel(
          chat.channel,
          channel.chatroomId,
          Number.isFinite(broadcasterId) ? broadcasterId : undefined
        );
        await Promise.all([
          joining,
          emotes.loadChannelEmotes(
            String(channel.chatroomId),
            chat.channel,
            "kick",
            channel.kickUserId
          ),
        ]);
      }
    } catch (error) {
      if (cancellation.signal.aborted) return;
      logger.error("UI:Chat:MultiView", "failed to start multi-chat session", {
        channel: chat.key,
        error: error instanceof Error ? error.message : String(error),
      });
      reportFailure(chat.key);
    }
  })();

  return {
    channelKey: chat.key,
    dispose() {
      if (disposal) return disposal;
      cancellation.abort();
      unregisterRoute();
      disposal = startup.then(async () => {
        await Promise.allSettled([joining]);
        if (acquired) await service.release(chat.channel);
      });
      return disposal;
    },
  };
}

function retireChatSession(
  session: RetainedChatSession,
  pendingReleases: Map<string, Promise<void>>
): void {
  const release = session.dispose().catch((error: unknown) => {
    logger.error("UI:Chat:MultiView", "failed to release multi-chat session", {
      channel: session.channelKey,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  pendingReleases.set(session.channelKey, release);
  void release.then(() => {
    if (pendingReleases.get(session.channelKey) === release) {
      pendingReleases.delete(session.channelKey);
    }
  });
}

export function useMultiChatSessions(
  channels: readonly MultiChatChannel[],
  enabled: boolean
): { isLoading: boolean; failedChannels: readonly string[] } {
  const [failedSessionKeys, setFailedSessionKeys] = useState<readonly string[]>([]);
  const sessionsRef = useRef(new Map<string, RetainedChatSession>());
  const pendingReleasesRef = useRef(new Map<string, Promise<void>>());
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
  const sessionSignature = resolved.map(sessionIdentity).sort().join("|");

  useEffect(() => {
    const sessions = sessionsRef.current;
    const pendingReleases = pendingReleasesRef.current;
    return () => {
      for (const session of sessions.values()) retireChatSession(session, pendingReleases);
      sessions.clear();
    };
  }, []);

  useEffect(() => {
    const sessions = sessionsRef.current;
    const desired = new Map(
      (enabled ? resolvedRef.current : []).map((session) => [sessionIdentity(session), session])
    );
    const changedChannels = new Set<string>();

    for (const [identity, session] of sessions) {
      if (desired.has(identity)) continue;
      sessions.delete(identity);
      changedChannels.add(session.channelKey);
      retireChatSession(session, pendingReleasesRef.current);
    }
    for (const [identity, resolvedSession] of desired) {
      if (sessions.has(identity)) continue;
      changedChannels.add(resolvedSession.chat.key);
      sessions.set(
        identity,
        retainChatSession(
          resolvedSession,
          pendingReleasesRef.current.get(resolvedSession.chat.key),
          (channelKey) => setFailedSessionKeys((current) => [...new Set([...current, channelKey])])
        )
      );
    }
    if (changedChannels.size > 0) {
      setFailedSessionKeys((current) => current.filter((key) => !changedChannels.has(key)));
    }
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
