import { useEffect, useReducer, useState, type ComponentType } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileButton } from "@mobile/design/button";
import { MobileTextField } from "@mobile/design/text-input";
import { MobileDialog } from "@mobile/design/dialog";
import { ChatPanel } from "@mobile/features/chat/components/chat-panel";
import type { ChatInteractions } from "@mobile/features/chat/capabilities/chat-interactions";
import type { MultistreamChat } from "../capabilities/multistream-chat";
import { mobileColors, mobileType } from "@mobile/design/tokens";
import type { MultistreamSession } from "../capabilities/multistream";

export type MultistreamWorkspaceProps = {
  readonly session: MultistreamSession;
  readonly PlayerSurface: ComponentType<{
    readonly sessionId: string;
    readonly testID?: string;
  }>;
  readonly chat?: MultistreamChat;
  readonly interactions?: ChatInteractions;
};
export function MultistreamWorkspace({
  session,
  PlayerSurface,
  chat,
  interactions,
}: MultistreamWorkspaceProps) {
  const [, refresh] = useReducer((value) => value + 1, 0);
  const snapshot = session.snapshot();
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [login, setLogin] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [channelChat, setChannelChat] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  useEffect(() => {
    const unsubscribe = session.subscribe(refresh);
    return () => {
      unsubscribe();
      void session.close();
    };
  }, [session]);
  useEffect(() => {
    const unsubscribe = chat?.subscribe(refresh);
    return () => {
      unsubscribe?.();
      chat?.dispose();
      interactions?.dispose();
    };
  }, [chat, interactions]);
  useEffect(() => {
    chat?.attach(snapshot.tiles);
  }, [chat, snapshot.tiles]);
  const selectedChat = snapshot.tiles.find((tile) => tile.id === channelChat);
  const chatId = selectedChat?.id ?? null;
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.workspace}
        testID="screen-more-multistream"
      >
        <Text style={mobileType.display}>Multistream</Text>
        <Text style={styles.body}>
          Watch up to {snapshot.limit} live channels. One stream plays audio at
          a time. Players stop when you leave this workspace.
        </Text>
        <View style={styles.row}>
          {(["twitch", "kick"] as const).map((value) => (
            <MobileButton
              key={value}
              accessibilityLabel={`Select ${value}`}
              onPress={() => setPlatform(value)}
              testID={`multistream-platform-${value}`}
              variant={platform === value ? value : "secondary"}
            >
              {value === "twitch" ? "Twitch" : "Kick"}
            </MobileButton>
          ))}
        </View>
        {chat && snapshot.tiles.length > 0 ? (
          <View style={styles.chat}>
            <View style={styles.row}>
              <MobileButton
                accessibilityLabel="Show merged chat"
                onPress={() => setChannelChat(null)}
                testID="multistream-chat-merged"
                variant={chatId === null ? "primary" : "secondary"}
              >
                Merged chat
              </MobileButton>
              {snapshot.tiles.map((tile) => (
                <MobileButton
                  key={tile.id}
                  accessibilityLabel={`Show ${tile.target.channelName} chat`}
                  onPress={() => setChannelChat(tile.id)}
                  testID={`multistream-chat-${tile.id}`}
                  variant={chatId === tile.id ? "primary" : "secondary"}
                >
                  {tile.target.channelName}
                </MobileButton>
              ))}
            </View>
            <Text style={styles.body}>
              {selectedChat
                ? `Send to ${selectedChat.target.channelName}.`
                : "Read all channels here. Choose a channel to send messages."}
            </Text>
            <ChatPanel
              chat={chat.snapshot(chatId)}
              platform={selectedChat?.target.platform ?? "twitch"}
              readOnly={!selectedChat}
              title={
                selectedChat
                  ? `${selectedChat.target.channelName} chat`
                  : "Merged chat"
              }
              onRetry={() => chat.retry(chatId)}
              {...(selectedChat ? { target: selectedChat.target } : {})}
              {...(selectedChat && interactions ? { interactions } : {})}
            />
          </View>
        ) : null}
        <MobileTextField
          label="Channel username"
          value={login}
          onChange={setLogin}
          placeholder="Enter a live channel"
          disabled={snapshot.busy}
        />
        <View style={styles.row}>
          <MobileButton
            accessibilityLabel="Add stream"
            busy={snapshot.busy}
            disabled={snapshot.tiles.length >= snapshot.limit || !login.trim()}
            onPress={() => {
              void session.add(platform, login);
            }}
            testID="multistream-add"
            variant="primary"
          >
            Add stream
          </MobileButton>
          <MobileButton
            accessibilityLabel="Mute all streams"
            disabled={snapshot.busy || snapshot.audioOwner === null}
            onPress={() => {
              void session.mute();
            }}
            testID="multistream-mute-all"
            variant="secondary"
          >
            Mute all
          </MobileButton>
        </View>
        {snapshot.status ? (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {snapshot.status}
          </Text>
        ) : null}
        {snapshot.tiles.length === 0 ? (
          <Text style={styles.body}>
            Add a channel to start. Streams begin muted.
          </Text>
        ) : null}
        <View style={styles.grid}>
          {snapshot.tiles.map((tile, index) => (
            <View
              key={tile.id}
              style={[styles.tile, width >= 600 ? styles.half : null]}
              testID={`multistream-tile-${tile.id}`}
            >
              <View style={styles.player}>
                <PlayerSurface
                  sessionId={tile.id}
                  testID={`multistream-player-${tile.id}`}
                />
              </View>
              <Text style={mobileType.title}>
                {tile.target.channelName} ·{" "}
                {tile.target.platform === "twitch" ? "Twitch" : "Kick"}
              </Text>
              <Text style={styles.body}>
                {tile.detail ??
                  (snapshot.audioOwner === tile.id ? "Audio on" : "Muted")}
              </Text>
              <View style={styles.row}>
                <MobileButton
                  accessibilityLabel={`Listen to ${tile.target.channelName}`}
                  disabled={
                    snapshot.busy ||
                    tile.state === "failed" ||
                    snapshot.audioOwner === tile.id
                  }
                  onPress={() => {
                    void session.focus(tile.id);
                  }}
                  testID={`multistream-listen-${tile.id}`}
                  variant="primary"
                >
                  Listen
                </MobileButton>
                <MobileButton
                  accessibilityLabel={`${tile.state === "paused" ? "Resume" : "Pause"} ${tile.target.channelName}`}
                  disabled={snapshot.busy || tile.state === "failed"}
                  onPress={() => {
                    void session.pause(tile.id, tile.state !== "paused");
                  }}
                  testID={`multistream-pause-${tile.id}`}
                  variant="secondary"
                >
                  {tile.state === "paused" ? "Resume" : "Pause"}
                </MobileButton>
                <MobileButton
                  accessibilityLabel={`Remove ${tile.target.channelName}`}
                  disabled={snapshot.busy}
                  onPress={() => setRemoving(tile.id)}
                  testID={`multistream-remove-${tile.id}`}
                  variant="ghost"
                >
                  Remove
                </MobileButton>
                <MobileButton
                  accessibilityLabel={`Move ${tile.target.channelName} earlier`}
                  disabled={snapshot.busy || index === 0}
                  onPress={() => session.move(tile.id, "earlier")}
                  testID={`multistream-earlier-${tile.id}`}
                  variant="ghost"
                >
                  Move earlier
                </MobileButton>
                <MobileButton
                  accessibilityLabel={`Move ${tile.target.channelName} later`}
                  disabled={
                    snapshot.busy || index === snapshot.tiles.length - 1
                  }
                  onPress={() => session.move(tile.id, "later")}
                  testID={`multistream-later-${tile.id}`}
                  variant="ghost"
                >
                  Move later
                </MobileButton>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <MobileDialog
        visible={removing !== null}
        title="Remove stream?"
        message="This stops the selected player and disconnects its chat."
        confirmLabel="Remove stream"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void session.remove(removing);
          setRemoving(null);
        }}
      />
    </>
  );
}
const styles = StyleSheet.create({
  workspace: { backgroundColor: mobileColors.background, padding: 16, gap: 16 },
  body: { ...mobileType.body, color: mobileColors.textSecondary },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    width: "100%",
    backgroundColor: mobileColors.surface,
    padding: 12,
    borderRadius: 12,
    gap: 12,
  },
  half: { width: "48%" },
  player: {
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    overflow: "hidden",
    borderRadius: 8,
  },
  chat: { minHeight: 360, gap: 12 },
});
