import type React from "react";
import { memo, useEffect } from "react";

import { ensureEmoteProvidersInitialized } from "../../backend/services/emotes";
import type { ChatPlatform } from "../../shared/chat-types";
import { useRenderCount } from "../dev/use-render-count";

import { KickChat } from "./kick/KickChat";
import { TwitchChat } from "./twitch/TwitchChat";

export interface ChatPanelProps {
  /** Initial platform to display/send to */
  initialPlatform?: ChatPlatform;
  /** Initial channel name */
  initialChannel?: string;
  /** Chatroom ID for Kick (if applicable) */
  chatroomId?: number;
  /** Channel ID for Twitch (string) or Kick (number/string) */
  channelId?: string;
  /** Subscriber badges for Kick (if applicable) */
  subscriberBadges?: any[];
}

// Memoized: combined with the narrowed connectionStatus selectors in
// KickChat/TwitchChat, this prevents the chat subtree from reconciling on
// every 30s `useStreams` refetch in the parent Stream page.
export const ChatPanel: React.FC<ChatPanelProps> = memo(function ChatPanel({
  initialPlatform = "twitch",
  initialChannel = "",
  chatroomId,
  channelId,
  subscriberBadges,
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
      <KickChat
        channel={initialChannel}
        channelId={channelId}
        chatroomId={chatroomId}
        subscriberBadges={subscriberBadges}
      />
    );
  }

  return <TwitchChat channel={initialChannel} channelId={channelId} />;
});
