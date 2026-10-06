import { memo, useMemo, useSyncExternalStore } from "react";
import {
  ChatEngagementInline,
  type ChatEngagementInlineBindings,
} from "@mobile/features/engagement/components/chat-engagement-inline";
import type { WatchChatSession } from "../capabilities/watch-chat";
import { ChatPanel } from "./chat-panel";

export const SubscribedChatPanel = memo(function SubscribedChatPanel({
  session,
  inlineEngagement,
  ...props
}: Omit<Parameters<typeof ChatPanel>[0], "chat" | "engagementHeader"> & {
  readonly session: WatchChatSession;
  readonly inlineEngagement?: ChatEngagementInlineBindings;
}) {
  const chat = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const target = props.target;
  const platform = target?.platform;
  const channelId = target?.channelId;
  const channelName = target?.channelName;
  const channel = useMemo(
    () =>
      platform !== undefined &&
      channelId !== undefined &&
      channelName !== undefined
        ? {
            platform,
            id: channelId,
            login: channelName,
            name: channelName,
          }
        : null,
    [platform, channelId, channelName],
  );
  const engagementHeader =
    inlineEngagement && channel && !props.recorded ? (
      <ChatEngagementInline channel={channel} {...inlineEngagement} />
    ) : undefined;
  return (
    <ChatPanel {...props} chat={chat} engagementHeader={engagementHeader} />
  );
});
