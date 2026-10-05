import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type {
  FocusedPlaybackPort,
  HlsSourceUri,
} from "@mobile/features/watch/capabilities/watch";
import { createMultistreamSession } from "../domain/multistream-session";
import { MultistreamWorkspace } from "./multistream-workspace";
import { createMultistreamChat } from "../domain/multistream-chat";
import { createChatInteractions } from "@mobile/features/chat/domain/chat-interactions";
import type { WatchChatAvailability } from "@mobile/features/chat/capabilities/watch-chat";

function Player({ sessionId }: { readonly sessionId: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "white" }}>Player {sessionId}</Text>
    </View>
  );
}
function WorkspaceStory() {
  const runtime = useMemo(() => {
    let nextId = 0;
    const applied = async (id: string) => ({
      kind: "applied" as const,
      session: { sessionId: id, pictureInPictureEligible: false },
    });
    const playback: FocusedPlaybackPort = {
      start: async (input) => ({
        kind: "started",
        session: {
          sessionId: input.sessionId,
          pictureInPictureEligible: false,
        },
      }),
      end: async (id) => ({ kind: "ended", sessionId: id }),
      setMuted: applied,
      setPlaying: applied,
      setVolume: applied,
      seekTo: applied,
      enterPictureInPicture: async () => ({
        kind: "unsupported",
        failure: {
          code: "OPERATION_UNSUPPORTED",
          detail: "Storybook does not host a native player.",
        },
      }),
      listQualities: async (id) => ({
        kind: "listed",
        catalog: { sessionId: id, selected: "auto", qualities: ["auto"] },
      }),
      setQuality: async (id) => ({
        kind: "listed",
        catalog: { sessionId: id, selected: "auto", qualities: ["auto"] },
      }),
      subscribe: () => () => {},
    };
    const session = createMultistreamSession({
      playback,
      channels: {
        find: async (platform, login) => ({
          platform,
          channelId: login,
          channelName: login,
        }),
      },
      resolve: async () => ({
        kind: "resolved",
        integration: "twitch-gql-usher",
        sourceUri: "https://example.com/live.m3u8" as HlsSourceUri,
        requestHeaders: {},
      }),
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      sessionIds: { create: () => String(++nextId) },
      limit: () => 2,
      beforeStart: async () => {},
    });
    const chat = createMultistreamChat(() => {
      let view: WatchChatAvailability = {
        kind: "empty",
        detail: "Connecting.",
      };
      const listeners = new Set<() => void>();
      return {
        attach(target) {
          view = {
            kind: "live",
            detail: "Connected.",
            messages: [
              {
                id: "1",
                displayName: "Viewer",
                text: `Hello ${target.channelName}`,
                badges: [],
              },
            ],
          };
          for (const listener of listeners) listener();
        },
        snapshot: () => view,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        retry() {},
        dispose() {
          listeners.clear();
        },
      };
    });
    const interactions = createChatInteractions(
      {
        access: async () => ({
          allowed: true,
          detail: "Chatting as preview user.",
        }),
        subscribe: () => () => {},
        send: async () => ({ kind: "sent", messageId: "preview-message" }),
        userAction: async () => ({ kind: "completed" }),
      },
      { read: async () => ({ emotes: [], failures: [] }) },
    );
    return { session, chat, interactions };
  }, []);
  return <MultistreamWorkspace {...runtime} PlayerSurface={Player} />;
}
const meta = {
  title: "Android/Workflows/Multistream",
  component: WorkspaceStory,
} satisfies Meta<typeof WorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Workspace: Story = {};
