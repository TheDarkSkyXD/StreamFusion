import { useEffect, useReducer, useState, type ComponentType } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ellipsis, Plus, Volume2, VolumeX } from "lucide-react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileButton } from "@mobile/design/button";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileChoiceGroup } from "@mobile/design/choice-group";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileTextField } from "@mobile/design/text-input";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import { ChatPanel } from "@mobile/features/chat/components/chat-panel";
import type { ChatInteractions } from "@mobile/features/chat/capabilities/chat-interactions";
import type { MultistreamChat } from "../capabilities/multistream-chat";
import {
  mobileColors,
  mobileSpacing,
  mobileSizing,
  mobileType,
} from "@mobile/design/tokens";
import type { MultistreamSession } from "../capabilities/multistream";

type WorkspaceSheet =
  | { readonly kind: "closed" }
  | { readonly kind: "add" }
  | { readonly kind: "audio" }
  | { readonly kind: "tile"; readonly id: string };
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
  const [sheet, setSheet] = useState<WorkspaceSheet>({ kind: "closed" });
  const [removing, setRemoving] = useState<string | null>(null);
  const [channelChat, setChannelChat] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  const selectedTile =
    sheet.kind === "tile"
      ? snapshot.tiles.find((tile) => tile.id === sheet.id)
      : undefined;
  const closeSheet = () => setSheet({ kind: "closed" });
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
  const audioOwner = snapshot.tiles.find(
    (tile) => tile.id === snapshot.audioOwner,
  );
  const availableWidth =
    gridWidth ?? Math.min(width, mobileSizing.readableContentMaximum) - 32;
  const tileWidth =
    availableWidth >= 328 ? (availableWidth - 12) / 2 : availableWidth;
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.workspace}
        keyboardShouldPersistTaps="handled"
        testID="screen-more-multistream"
      >
        <View style={styles.toolbar}>
          <View style={styles.copy}>
            <Text style={mobileType.label}>
              {snapshot.tiles.length} of {snapshot.limit} streams
            </Text>
            <Text style={mobileType.body}>
              {audioOwner
                ? `Listening to ${audioOwner.target.channelName}`
                : "All streams muted"}
            </Text>
          </View>
          <MobileIconButton
            label="Choose audio source"
            onPress={() => setSheet({ kind: "audio" })}
            disabled={snapshot.tiles.length === 0}
          >
            <Volume2 color={mobileColors.textPrimary} size={22} />
          </MobileIconButton>
          <MobileIconButton
            label="Add stream"
            onPress={() => setSheet({ kind: "add" })}
            disabled={snapshot.tiles.length >= snapshot.limit}
          >
            <Plus color={mobileColors.textPrimary} size={22} />
          </MobileIconButton>
        </View>
        {snapshot.resourcePressure.kind !== "clear" ? (
          <MobileStatusPanel tone="info" testID="multistream-resource-pressure">
            <Text accessibilityLiveRegion="polite" style={mobileType.body}>
              {snapshot.resourcePressure.detail}
            </Text>
            {snapshot.resourcePressure.kind === "pressured" &&
            snapshot.tiles.length > 1 ? (
              <MobileButton
                accessibilityLabel="Reduce to one stream"
                onPress={() => void session.reduceToOne()}
                disabled={snapshot.busy}
                testID="multistream-reduce-to-one"
                variant="primary"
              >
                Keep one stream
              </MobileButton>
            ) : null}
          </MobileStatusPanel>
        ) : null}
        {snapshot.status ? (
          <MobileStatusPanel tone="info" testID="multistream-status">
            <Text accessibilityLiveRegion="polite" style={mobileType.body}>
              {snapshot.status}
            </Text>
          </MobileStatusPanel>
        ) : null}
        {snapshot.tiles.length === 0 ? (
          <View style={styles.empty}>
            <Text style={mobileType.title}>Watch together</Text>
            <Text style={mobileType.body}>
              Add live channels from Twitch and Kick. One stream plays audio at
              a time.
            </Text>
            <MobileButton
              accessibilityLabel="Add your first stream"
              testID="multistream-add-first"
              onPress={() => setSheet({ kind: "add" })}
              variant="primary"
            >
              Add stream
            </MobileButton>
          </View>
        ) : null}
        <View
          style={styles.grid}
          onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
        >
          {snapshot.tiles.map((tile) => (
            <View
              key={tile.id}
              style={[styles.tile, { width: tileWidth }]}
              testID={`multistream-tile-${tile.id}`}
            >
              <View style={styles.player}>
                <PlayerSurface
                  sessionId={tile.id}
                  testID={`multistream-player-${tile.id}`}
                />
              </View>
              <View style={styles.tileCopy}>
                <Text numberOfLines={1} style={styles.tileTitle}>
                  {tile.target.channelName}
                </Text>
                <MobilePlatformBadge
                  platform={tile.target.platform}
                  variant="icon"
                />
              </View>
              <View style={styles.toolbar}>
                <Text numberOfLines={2} style={[mobileType.label, styles.copy]}>
                  {tile.detail ??
                    (snapshot.audioOwner === tile.id
                      ? "Audio on"
                      : tile.state === "paused"
                        ? "Paused"
                        : "Muted")}
                </Text>
                <MobileIconButton
                  label={`Listen to ${tile.target.channelName}`}
                  disabled={
                    snapshot.busy ||
                    tile.state === "failed" ||
                    snapshot.audioOwner === tile.id
                  }
                  onPress={() => void session.focus(tile.id)}
                  testID={`multistream-listen-${tile.id}`}
                >
                  <Volume2 color={mobileColors.textPrimary} size={20} />
                </MobileIconButton>
                <MobileIconButton
                  label={`Actions for ${tile.target.channelName}`}
                  onPress={() => setSheet({ kind: "tile", id: tile.id })}
                >
                  <Ellipsis color={mobileColors.textPrimary} size={20} />
                </MobileIconButton>
              </View>
            </View>
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
            <Text style={mobileType.body}>
              {selectedChat
                ? `Send to ${selectedChat.target.channelName}.`
                : "Read all channels here. Choose a channel to send messages."}
            </Text>
            <ChatPanel
              key={chatId ?? "merged"}
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
      </ScrollView>
      <MobileBottomSheet
        visible={sheet.kind === "add"}
        title="Add stream"
        onDismiss={closeSheet}
        footer={
          <MobileButton
            accessibilityLabel="Add stream"
            busy={snapshot.busy}
            disabled={snapshot.tiles.length >= snapshot.limit || !login.trim()}
            onPress={() => {
              void session.add(platform, login).then(() => {
                if (
                  session
                    .snapshot()
                    .tiles.some(
                      (tile) =>
                        tile.target.platform === platform &&
                        tile.target.channelName.toLowerCase() ===
                          login.trim().toLowerCase(),
                    )
                ) {
                  setLogin("");
                  closeSheet();
                }
              });
            }}
            testID="multistream-add"
            variant="primary"
          >
            Add stream
          </MobileButton>
        }
      >
        <MobileChoiceGroup
          label="Platform"
          value={platform}
          onChange={setPlatform}
          options={[
            { value: "twitch", label: "Twitch" },
            { value: "kick", label: "Kick" },
          ]}
        />
        <MobileTextField
          label="Channel username"
          value={login}
          onChange={setLogin}
          placeholder="Enter a live channel"
          autoCapitalize="none"
          autoCorrect={false}
          disabled={snapshot.busy}
          testID="multistream-login"
        />
        {snapshot.status ? (
          <Text accessibilityLiveRegion="polite" style={mobileType.body}>
            {snapshot.status}
          </Text>
        ) : null}
        <Text style={mobileType.label}>
          Streams start muted. Players stop when you leave Multistream.
        </Text>
      </MobileBottomSheet>
      <MobileBottomSheet
        visible={sheet.kind === "audio"}
        title="Audio source"
        onDismiss={closeSheet}
      >
        <MobileListRow
          title="Mute all streams"
          description="Keep every stream silent"
          leading={<VolumeX size={22} color={mobileColors.textPrimary} />}
          disabled={snapshot.busy || snapshot.audioOwner === null}
          onPress={() => {
            void session.mute();
          }}
          testID="multistream-mute-all"
        />
        {snapshot.tiles.map((tile) => (
          <MobileListRow
            key={tile.id}
            title={tile.target.channelName}
            description={
              snapshot.audioOwner === tile.id
                ? "Current audio source"
                : tile.state === "failed"
                  ? "Player unavailable"
                  : "Switch audio to this stream"
            }
            disabled={
              snapshot.busy ||
              tile.state === "failed" ||
              snapshot.audioOwner === tile.id
            }
            onPress={() => {
              void session.focus(tile.id);
            }}
          />
        ))}
        {snapshot.status ? (
          <Text accessibilityLiveRegion="polite" style={mobileType.body}>
            {snapshot.status}
          </Text>
        ) : null}
      </MobileBottomSheet>
      <MobileBottomSheet
        visible={sheet.kind === "tile" && selectedTile !== undefined}
        title={selectedTile?.target.channelName ?? "Stream actions"}
        onDismiss={closeSheet}
      >
        {selectedTile ? (
          <>
            <MobileListRow
              title={selectedTile.state === "paused" ? "Resume" : "Pause"}
              disabled={snapshot.busy || selectedTile.state === "failed"}
              onPress={() => {
                void session.pause(
                  selectedTile.id,
                  selectedTile.state !== "paused",
                );
              }}
              testID={`multistream-pause-${selectedTile.id}`}
            />
            <MobileListRow
              title="Move earlier"
              disabled={
                snapshot.busy || snapshot.tiles[0]?.id === selectedTile.id
              }
              onPress={() => session.move(selectedTile.id, "earlier")}
              testID={`multistream-earlier-${selectedTile.id}`}
            />
            <MobileListRow
              title="Move later"
              disabled={
                snapshot.busy ||
                snapshot.tiles[snapshot.tiles.length - 1]?.id ===
                  selectedTile.id
              }
              onPress={() => session.move(selectedTile.id, "later")}
              testID={`multistream-later-${selectedTile.id}`}
            />
            <MobileListRow
              title="Remove stream"
              destructive
              disabled={snapshot.busy}
              onPress={() => {
                setRemoving(selectedTile.id);
                closeSheet();
              }}
              testID={`multistream-remove-${selectedTile.id}`}
            />
          </>
        ) : null}
      </MobileBottomSheet>
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
  workspace: {
    backgroundColor: mobileColors.background,
    padding: mobileSpacing.medium,
    gap: mobileSpacing.medium,
    width: "100%",
    maxWidth: mobileSizing.readableContentMaximum,
    alignSelf: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.xSmall,
  },
  empty: {
    backgroundColor: mobileColors.surface,
    padding: mobileSpacing.large,
    borderRadius: 12,
    gap: mobileSpacing.medium,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    backgroundColor: mobileColors.surface,
    borderRadius: 12,
    overflow: "hidden",
    gap: mobileSpacing.small,
  },
  tileCopy: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
  },
  tileTitle: { ...mobileType.title, flex: 1, minWidth: 0, fontSize: 14 },
  player: {
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  chat: { minHeight: 360, gap: 12 },
});
