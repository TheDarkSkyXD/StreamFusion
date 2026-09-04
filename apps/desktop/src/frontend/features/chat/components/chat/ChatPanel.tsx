import { useTranslation } from "react-i18next";
import type React from "react";
import { lazy, memo, Suspense, useEffect } from "react";

import { ensureEmoteProvidersInitialized } from "../../../../../backend/services/emotes";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import { useRenderCount } from "../../../../components/dev/use-render-count";
import { loadKickChatComponent, loadTwitchChatComponent } from "./platform-chat-loader";

import type { SubscriberBadge } from "@backend/services/chat/kick-parser";

const LazyKickChat = lazy(loadKickChatComponent);
const LazyTwitchChat = lazy(loadTwitchChatComponent);

export interface ChatPanelProps {
  /** Initial platform to display/send to */
  initialPlatform?: ChatPlatform;
  /** Initial channel name */
  initialChannel?: string;
  /** Chatroom ID for Kick (if applicable) */
  chatroomId?: number;
  /** Channel ID for Twitch (string) or Kick (number/string) */
  channelId?: string;
  /** Kick legacy channel/db ID used by the recent-message endpoint */
  kickChannelId?: string;
  /** Kick broadcaster user_id (for resolving 7TV channel emotes) */
  kickUserId?: string;
  /** Whether the selected Kick channel is a Partner channel. */
  isPartnerChannel?: boolean;
  /** Subscriber badges for Kick (if applicable) */
  subscriberBadges?: SubscriberBadge[];
  badgeCatalogState?: "loading" | "ready" | "failed";
  retryBadgeCatalog?: () => void;
  /** Mount the message composer. Home uses a read-only chat rail. */
  showComposer?: boolean;
}

// Memoized: combined with the narrowed connectionStatus selectors in
// KickChat/TwitchChat, this prevents the chat subtree from reconciling on
// every 30s `useStreams` refetch in the parent Stream page.
export const ChatPanel: React.FC<ChatPanelProps> = memo(function ChatPanel({
  initialPlatform = "twitch",
  initialChannel = "",
  chatroomId,
  channelId,
  kickChannelId,
  kickUserId,
  isPartnerChannel,
  subscriberBadges,
  badgeCatalogState,
  retryBadgeCatalog,
  showComposer = true,
}) {
  useRenderCount("ChatPanel");
  // Kick's official moderation APIs are keyed by broadcaster user_id. The
  // legacy channel/db id is only valid for web chat endpoints.
  const canonicalKickChannelId = kickUserId ?? channelId;
  // Register emote providers lazily — chat is the only consumer, so pages
  // without chat (Home, Categories, …) don't pay the cost at app boot.
  useEffect(() => {
    ensureEmoteProvidersInitialized();
  }, []);

  // Note: Global emotes are loaded by child components (TwitchChat/KickChat)
  // after they configure their respective providers with credentials

  if (initialPlatform === "kick") {
    return (
      <Suspense fallback={<ChatPanelLoading />}>
        <LazyKickChat
          channel={initialChannel}
          channelId={canonicalKickChannelId}
          kickChannelId={kickChannelId}
          chatroomId={chatroomId}
          kickUserId={kickUserId}
          isPartnerChannel={isPartnerChannel}
          subscriberBadges={subscriberBadges}
          badgeCatalogState={badgeCatalogState}
          retryBadgeCatalog={retryBadgeCatalog}
          showComposer={showComposer}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<ChatPanelLoading />}>
      <LazyTwitchChat channel={initialChannel} channelId={channelId} showComposer={showComposer} />
    </Suspense>
  );
});

function ChatPanelLoading() {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full min-h-48 items-center justify-center text-sm text-[var(--color-foreground-muted)]"
      role="status"
    >
      {t("chat.loadingChat")}
    </div>
  );
}
