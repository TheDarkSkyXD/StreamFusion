import type React from "react";
import { lazy, memo, Suspense, useEffect } from "react";

import {
  preloadChatService,
  shutdownLoadedChatServices,
} from "../../backend/services/chat/chat-service-loader";
import { ensureEmoteProvidersInitialized } from "../../backend/services/emotes";
import { registerAppShutdownTask } from "../../hooks/app-shutdown-registry";
import type { ChatPlatform } from "../../shared/chat-types";
import { useRenderCount } from "../dev/use-render-count";

import type { SubscriberBadge } from "@/backend/services/chat/kick-parser";

let kickChatComponentPromise:
  | Promise<{
      default: typeof import("./kick/KickChat").KickChat;
    }>
  | undefined;
let twitchChatComponentPromise:
  | Promise<{
      default: typeof import("./twitch/TwitchChat").TwitchChat;
    }>
  | undefined;

const loadKickChatComponent = () =>
  (kickChatComponentPromise ??= Promise.all([
    import("./kick/KickChat"),
    preloadChatService("kick"),
  ]).then(([module]) => ({ default: module.KickChat })));
const loadTwitchChatComponent = () =>
  (twitchChatComponentPromise ??= Promise.all([
    import("./twitch/TwitchChat"),
    preloadChatService("twitch"),
  ]).then(([module]) => ({ default: module.TwitchChat })));

const LazyKickChat = lazy(loadKickChatComponent);
const LazyTwitchChat = lazy(loadTwitchChatComponent);

export function preloadPlatformChat(platform: ChatPlatform): Promise<void> {
  const componentPromise =
    platform === "kick" ? loadKickChatComponent() : loadTwitchChatComponent();
  return Promise.all([componentPromise, preloadChatService(platform)]).then(() => undefined);
}

registerAppShutdownTask("chat-services", shutdownLoadedChatServices);

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
  subscriberBadges,
  badgeCatalogState,
  retryBadgeCatalog,
  showComposer = true,
}) {
  useRenderCount("ChatPanel");
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
          channelId={channelId}
          kickChannelId={kickChannelId}
          chatroomId={chatroomId}
          kickUserId={kickUserId}
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
  return (
    <div
      className="flex h-full min-h-48 items-center justify-center text-sm text-[var(--color-foreground-muted)]"
      role="status"
    >
      Loading chat…
    </div>
  );
}
