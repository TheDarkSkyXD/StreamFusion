import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Text } from "react-native";
import { mobileType } from "@mobile/design/tokens";
import type { ChatInteractions } from "../capabilities/chat-interactions";
import type {
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatSession,
} from "../capabilities/watch-chat";
import { ChatPanel } from "./chat-panel";

export type ConnectedChatRuntime = {
  readonly chat: WatchChatSession;
  readonly interactions: ChatInteractions;
};

export function ConnectedChatPanel({
  runtime,
  target,
  onModerateMessage,
}: {
  readonly runtime: ConnectedChatRuntime;
  readonly target: WatchChatConnectInput;
  readonly onModerateMessage?: (message: WatchChatMessage) => void;
}) {
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const availability = useSyncExternalStore(
    runtime.chat.subscribe,
    runtime.chat.snapshot,
    runtime.chat.snapshot,
  );
  const { channelId, channelName, platform } = target;
  useEffect(() => {
    const attach = () =>
      runtime.chat.attach({ channelId, channelName, platform });
    if (AppState.currentState === "active") attach();
    const listener = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setForeground(active);
      if (active) attach();
      else {
        runtime.chat.dispose();
        runtime.interactions.dispose();
      }
    });
    return () => {
      listener.remove();
      runtime.chat.dispose();
      runtime.interactions.dispose();
    };
  }, [runtime, channelId, channelName, platform]);
  if (!foreground)
    return (
      <Text style={mobileType.body}>Chat reconnects when you return.</Text>
    );
  return (
    <ChatPanel
      chat={availability}
      platform={platform}
      target={target}
      interactions={runtime.interactions}
      onRetry={runtime.chat.retry}
      {...(onModerateMessage ? { onModerateMessage } : {})}
    />
  );
}
