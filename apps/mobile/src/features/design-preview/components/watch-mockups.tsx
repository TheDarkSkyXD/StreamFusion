import { useState } from "react";
import {
  Captions,
  Download,
  Ellipsis,
  Maximize,
  Heart,
  MessageCircle,
  Smile,
  Volume2,
  X,
} from "lucide-react-native";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileSettingsIcon } from "@mobile/design/settings-icon";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileListState } from "@mobile/design/list-state";
import { MobileSelect } from "@mobile/design/select";
import { MobileProgress, MobileSnackbar } from "@mobile/design/feedback";
import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import {
  mobileColors as colors,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import {
  PreviewAvatar,
  PreviewPlayer,
  PreviewStreamCard,
} from "./catalog-elements";
import {
  PreviewFrame,
  PreviewSection,
  previewStyles as ui,
} from "./preview-frame";

export type WatchMockupKind =
  | "live"
  | "video"
  | "clip"
  | "guest-chat"
  | "composer"
  | "replay"
  | "fullscreen"
  | "mini-player"
  | "quality"
  | "recording"
  | "captions"
  | "prediction"
  | "poll"
  | "emotes"
  | "user"
  | "error";
type WatchSheet =
  "closed" | "controls" | "actions" | "emotes" | "user" | "prediction" | "poll";

const initialMessages = [
  {
    name: "aurora",
    text: "Welcome in! Taking the scenic route tonight.",
    badge: "Broadcaster",
  },
  { name: "juniper", text: "The lighting here is so good", badge: "Moderator" },
  { name: "kai", text: "That view was worth the climb", badge: "Subscriber" },
  { name: "river", text: "One more adventure?", badge: "" },
  { name: "moss", text: "hello from the other side of the world", badge: "" },
  { name: "atlas", text: "Let's build a cabin here", badge: "VIP" },
];

export function WatchMockup({
  kind = "live",
}: {
  readonly kind?: WatchMockupKind;
}) {
  const [playing, setPlaying] = useState(true);
  const [quality, setQuality] = useState("auto");
  const [tab, setTab] = useState("chat");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [sheet, setSheet] = useState<WatchSheet>(
    kind === "quality"
      ? "controls"
      : kind === "emotes"
        ? "emotes"
        : kind === "user"
          ? "user"
          : kind === "prediction"
            ? "prediction"
            : kind === "poll"
              ? "poll"
              : "closed",
  );
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(kind === "recording");
  const [confirm, setConfirm] = useState(false);
  const [emoteSearch, setEmoteSearch] = useState("");
  const [choice, setChoice] = useState(kind === "poll" ? "mountains" : "yes");
  const [points, setPoints] = useState("100");
  const [fullscreen, setFullscreen] = useState(kind === "fullscreen");
  const [minimized, setMinimized] = useState(kind === "mini-player");
  const { width } = useWindowDimensions();
  const wide = width >= 840;
  const composer = [
    "composer",
    "emotes",
    "user",
    "prediction",
    "poll",
  ].includes(kind);
  const recorded = kind === "video" || kind === "clip" || kind === "replay";
  const sendMessage = () => {
    if (!message.trim()) return;
    setMessages([
      ...messages,
      { name: "you", text: message.trim(), badge: "" },
    ]);
    setMessage("");
  };
  const chat = (
    <View style={styles.chat}>
      <View style={styles.chatHeader}>
        <Text style={mobileType.title}>
          {recorded ? "Comments" : "Stream chat"}
        </Text>
        <Text style={mobileType.label}>Twitch</Text>
        {composer ? (
          <MobileIconButton
            label="Chat actions"
            onPress={() => setSheet("actions")}
          >
            <Ellipsis color={colors.textPrimary} size={20} />
          </MobileIconButton>
        ) : null}
      </View>
      <ScrollView tabIndex={0} contentContainerStyle={styles.messages}>
        {recorded && kind !== "replay" ? (
          <MobileListState
            message="Recorded comments are not available on mobile yet."
            phase="empty"
            title="Comments unavailable"
          />
        ) : (
          <>
            {kind === "replay" ? (
              <Text style={styles.systemMessage}>
                Chat replay proposal · 00:14:32
              </Text>
            ) : null}
            {composer ? (
              <View style={[ui.card, ui.padded]}>
                <Text style={mobileType.label}>Pinned by aurora</Text>
                <Text style={mobileType.body}>
                  {"Tonight's build: a little cabin by the river."}
                </Text>
              </View>
            ) : null}
            {messages.map((row, index) => (
              <Pressable
                key={`${index}-${row.name}`}
                accessibilityLabel={`Open ${row.name}, ${row.text}`}
                accessibilityRole={composer ? "button" : "text"}
                disabled={!composer}
                onPress={() => setSheet("user")}
                style={styles.message}
              >
                <Text style={styles.messageText}>
                  {row.badge ? (
                    <Text style={styles.badge}>{row.badge} </Text>
                  ) : null}
                  <Text style={styles.username}>{row.name} </Text>
                  {row.text}
                </Text>
              </Pressable>
            ))}
            {composer ? (
              <Text style={styles.systemMessage}>
                juniper gifted 5 subscriptions to the community.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
      {composer ? (
        <View style={styles.composer}>
          <MobileIconButton
            label="Open emotes"
            onPress={() => setSheet("emotes")}
          >
            <Smile color={colors.textPrimary} size={22} />
          </MobileIconButton>
          <TextInput
            accessibilityLabel="Message"
            placeholder="Send a message"
            placeholderTextColor={colors.textSecondary}
            style={styles.messageInput}
            value={message}
            onChangeText={setMessage}
            onSubmitEditing={sendMessage}
          />
          <MobileButton
            accessibilityLabel="Send message"
            disabled={!message.trim()}
            onPress={sendMessage}
            testID="chat-send"
            variant="primary"
          >
            Send
          </MobileButton>
        </View>
      ) : !recorded ? (
        <View style={[styles.composer, styles.guest]}>
          <Text style={[mobileType.label, ui.grow]}>
            Guest chat is read-only
          </Text>
          <MobileButton
            accessibilityLabel="Connect account"
            onPress={() => setNotice("Account connection preview")}
            testID="chat-connect"
            variant="secondary"
          >
            Connect
          </MobileButton>
        </View>
      ) : null}
    </View>
  );
  const player = (
    <View style={wide ? styles.playerWide : null}>
      {kind === "error" ? (
        <View style={styles.failedPlayer}>
          <MobileListState
            message="The stream could not be loaded. Your place in chat is saved."
            onRetry={() => setNotice("Retry requested")}
            phase="error"
            title="Playback interrupted"
          />
        </View>
      ) : (
        <PreviewPlayer
          media={recorded ? (kind === "clip" ? "clip" : "video") : "live"}
          playing={playing}
          onPlay={() => setPlaying(!playing)}
        />
      )}
      {recorded ? (
        <View style={[ui.padded, styles.timeline]}>
          <MobileProgress
            label={kind === "clip" ? "00:18 of 00:42" : "14:32 of 2:18:05"}
            value={kind === "clip" ? 0.43 : 0.11}
          />
          <View style={ui.row}>
            {["Back 10s", "Forward 10s"].map((label) => (
              <MobileButton
                key={label}
                accessibilityLabel={label}
                onPress={() => setNotice(label)}
                testID={label}
                variant="ghost"
              >
                {label}
              </MobileButton>
            ))}
          </View>
        </View>
      ) : null}
      {kind === "captions" ? (
        <View style={styles.caption}>
          <Text style={styles.captionText}>
            {"Let's see what's on the other side of this mountain."}
          </Text>
        </View>
      ) : null}
      <View style={styles.streamMeta}>
        <View style={ui.row}>
          <PreviewAvatar name="aurora" />
          <View style={ui.grow}>
            <Text style={mobileType.title}>aurora</Text>
            <Text style={mobileType.label}>Minecraft · English</Text>
          </View>
          <MobileIconButton
            label="Follow aurora"
            onPress={() => setNotice("Follow saved")}
          >
            <Heart color={colors.textPrimary} size={22} />
          </MobileIconButton>
        </View>
        <Text numberOfLines={2} style={mobileType.body}>
          One more adventure before sunrise
        </Text>
      </View>
      <View style={styles.toolbar}>
        <MobileIconButton
          label="Settings"
          onPress={() => setSheet("controls")}
        >
          <MobileSettingsIcon color={colors.textPrimary} size={22} />
        </MobileIconButton>
        <MobileIconButton
          label="Fullscreen"
          onPress={() => setFullscreen(true)}
        >
          <Maximize color={colors.textPrimary} size={22} />
        </MobileIconButton>
        <MobileIconButton
          label="Captions"
          disabled={kind !== "captions"}
          onPress={() => setNotice("Caption controls are a proposed workflow")}
        >
          <Captions color={colors.textPrimary} size={22} />
        </MobileIconButton>
        <MobileIconButton
          label={recorded ? "Download" : "Start recording"}
          onPress={() =>
            recorded
              ? setNotice("Download saved in preview")
              : setRecording(true)
          }
        >
          <Download color={colors.textPrimary} size={22} />
        </MobileIconButton>
        <MobileIconButton
          label="More stream actions"
          onPress={() => setSheet("actions")}
        >
          <Ellipsis color={colors.textPrimary} size={22} />
        </MobileIconButton>
      </View>
      {recording ? (
        <View style={styles.recording}>
          <Text style={styles.recordingText}>● Recording · 12:48</Text>
          <MobileButton
            accessibilityLabel="Stop recording"
            onPress={() => setConfirm(true)}
            testID="stop-recording"
            variant="ghost"
          >
            Stop
          </MobileButton>
        </View>
      ) : null}
      {notice ? (
        <View style={ui.padded}>
          <MobileSnackbar
            message={notice}
            actionLabel="Dismiss"
            onAction={() => setNotice("")}
          />
        </View>
      ) : null}
    </View>
  );
  return (
    <>
      {minimized ? (
        <PreviewFrame title="Following" destination="following">
          <PreviewSection title="Live channels">
            <PreviewStreamCard onPress={() => setMinimized(false)} />
          </PreviewSection>
          <View style={styles.mini}>
            <PreviewPlayer
              playing={playing}
              onPlay={() => setPlaying(!playing)}
            />
            <MobileButton
              accessibilityLabel="Maximize mini-player"
              onPress={() => setMinimized(false)}
              testID="expand-mini"
              variant="ghost"
            >
              Maximize aurora
            </MobileButton>
          </View>
        </PreviewFrame>
      ) : fullscreen ? (
        <View style={styles.fullscreen}>
          <PreviewPlayer
            playing={playing}
            onPlay={() => setPlaying(!playing)}
          />
          <View style={styles.fullscreenControls}>
            <MobileIconButton
              label="Exit fullscreen"
              onPress={() => setFullscreen(false)}
            >
              <X color={colors.textPrimary} size={24} />
            </MobileIconButton>
            <Text style={mobileType.title}>aurora</Text>
            <MobileIconButton
              label="Open chat"
              onPress={() => {
                setFullscreen(false);
                setTab("chat");
              }}
            >
              <MessageCircle color={colors.textPrimary} size={22} />
            </MobileIconButton>
          </View>
        </View>
      ) : (
        <PreviewFrame
          title="Watch"
          destination="watch"
          scroll={false}
          headerAction={
            <MobileIconButton
              label="Minimize player"
              onPress={() => setMinimized(true)}
            >
              <Maximize color={colors.textPrimary} size={22} />
            </MobileIconButton>
          }
        >
          {wide ? (
            <View style={styles.wide}>
              {player}
              {chat}
            </View>
          ) : (
            <View style={styles.watch}>
              {player}
              <View style={styles.tabs}>
                <MobileUnderlineTabs
                  accessibilityLabel="Watch panes"
                  onSelect={setTab}
                  selectedId={tab}
                  tabs={[
                    { id: "chat", label: recorded ? "Comments" : "Chat" },
                    { id: "related", label: "Related" },
                  ]}
                />
              </View>
              {tab === "chat" ? (
                chat
              ) : (
                <ScrollView contentContainerStyle={ui.padded}>
                  <PreviewStreamCard
                    onPress={() => setNotice("Related stream selected")}
                  />
                </ScrollView>
              )}
            </View>
          )}
        </PreviewFrame>
      )}
      <MobileBottomSheet
        title={
          sheet === "controls"
            ? "Settings"
            : sheet === "emotes"
              ? "Emotes"
              : sheet === "user"
                ? "juniper"
                : sheet === "prediction"
                  ? "Will we finish the cabin?"
                  : sheet === "poll"
                    ? "Where do we go next?"
                    : "Stream actions"
        }
        visible={sheet !== "closed"}
        onDismiss={() => setSheet("closed")}
        size={sheet === "emotes" ? "expanded" : "content"}
      >
        {sheet === "controls" ? (
          <>
            <MobileSelect
              accessibilityLabel="Quality"
              testID="quality"
              options={[
                { value: "auto", label: "Auto • recommended" },
                { value: "1080", label: "1080p60 • source" },
                { value: "720", label: "720p60" },
                { value: "480", label: "480p" },
                { value: "audio", label: "Audio only" },
              ]}
              onChange={setQuality}
              value={quality}
            />
            <MobileListRow
              title="Volume"
              leading={<Volume2 color={colors.textPrimary} size={22} />}
              trailing={<Text style={mobileType.label}>80%</Text>}
            />
            <MobileProgress label="Volume" value={0.8} />
          </>
        ) : null}
        {sheet === "actions" ? (
          <>
            {[
              "Start recording",
              ...(composer
                ? ["Share stream", "Report channel", "Predictions", "Poll"]
                : []),
            ].map((title) => (
              <MobileListRow
                key={title}
                title={title}
                onPress={() => {
                  if (title === "Predictions") setSheet("prediction");
                  else if (title === "Poll") setSheet("poll");
                  else {
                    setSheet("closed");
                    if (title === "Start recording") setRecording(true);
                    setNotice(title);
                  }
                }}
              />
            ))}
          </>
        ) : null}
        {sheet === "emotes" ? (
          <>
            <TextInput
              accessibilityLabel="Search emotes"
              placeholder="Search emotes"
              placeholderTextColor={colors.textSecondary}
              style={ui.field}
              value={emoteSearch}
              onChangeText={setEmoteSearch}
            />
            <View style={ui.row}>
              {["All", "Twitch", "7TV", "BTTV"].map((label) => (
                <MobileFilterChip
                  key={label}
                  accessibilityLabel={label}
                  label={label}
                  onPress={() => setEmoteSearch(label === "All" ? "" : label)}
                  selected={emoteSearch === label}
                  testID={label}
                />
              ))}
            </View>
            <View style={styles.emotes}>
              {[
                "Kappa",
                "PogChamp",
                "LUL",
                "HeyGuys",
                "CoolCat",
                "ResidentSleeper",
                "BibleThump",
                "VoHiYo",
                "SeemsGood",
                "4Head",
                "NotLikeThis",
                "WutFace",
              ]
                .filter((name) =>
                  name.toLowerCase().includes(emoteSearch.toLowerCase()),
                )
                .map((name) => (
                  <Pressable
                    accessibilityLabel={`Insert ${name}`}
                    accessibilityRole="button"
                    key={name}
                    style={styles.emote}
                    onPress={() => {
                      setMessage(`${message}${message ? " " : ""}${name}`);
                      setSheet("closed");
                    }}
                  >
                    <Smile color={colors.textPrimary} size={28} />
                    <Text style={styles.emoteLabel}>{name}</Text>
                  </Pressable>
                ))}
            </View>
            <Text style={mobileType.label}>
              Emote artwork is represented by placeholders.
            </Text>
          </>
        ) : null}
        {sheet === "user" ? (
          <>
            <View style={ui.row}>
              <PreviewAvatar name="juniper" size={56} />
              <View>
                <Text style={mobileType.title}>juniper</Text>
                <Text style={mobileType.body}>
                  Moderator · Following since 2023
                </Text>
              </View>
            </View>
            {[
              "Reply",
              "Mention",
              "View profile",
              "Block user",
              "Report user",
            ].map((title) => (
              <MobileListRow
                key={title}
                title={title}
                onPress={() => {
                  setSheet("closed");
                  if (title === "Mention" || title === "Reply")
                    setMessage("@juniper ");
                  else setNotice(title);
                }}
              />
            ))}
          </>
        ) : null}
        {sheet === "prediction" || sheet === "poll" ? (
          <>
            <Text style={mobileType.body}>
              {sheet === "prediction"
                ? "Predict with channel points. Closes in 00:42."
                : "Vote for our next adventure. Ends in 01:20."}
            </Text>
            <View style={ui.row}>
              {(sheet === "prediction"
                ? ["yes", "no"]
                : ["mountains", "village", "cave"]
              ).map((id) => (
                <MobileFilterChip
                  accessibilityLabel={id}
                  key={id}
                  label={id.slice(0, 1).toUpperCase() + id.slice(1)}
                  onPress={() => setChoice(id)}
                  selected={choice === id}
                  testID={`choice-${id}`}
                />
              ))}
            </View>
            {sheet === "prediction" ? (
              <TextInput
                accessibilityLabel="Channel points"
                keyboardType="numeric"
                value={points}
                onChangeText={setPoints}
                style={ui.field}
              />
            ) : null}
            <MobileButton
              accessibilityLabel={
                sheet === "prediction" ? "Submit prediction" : "Vote"
              }
              onPress={() => {
                setNotice(
                  sheet === "prediction"
                    ? `Prediction saved in preview · ${points} points`
                    : `Vote saved in preview · ${choice}`,
                );
                setSheet("closed");
              }}
              testID="submit-engagement"
              variant="primary"
            >
              {sheet === "prediction" ? "Predict" : "Vote"}
            </MobileButton>
          </>
        ) : null}
      </MobileBottomSheet>
      <MobileDialog
        confirmLabel="Stop recording"
        destructive
        message="Finish the recording and save it to Downloads?"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setRecording(false);
          setConfirm(false);
          setNotice("Recording saved to Downloads");
        }}
        title="Stop recording?"
        visible={confirm}
      />
    </>
  );
}

const styles = StyleSheet.create({
  watch: { flex: 1, minHeight: 0 },
  wide: { flex: 1, flexDirection: "row", minHeight: 0 },
  playerWide: { flex: 2 },
  streamMeta: {
    paddingHorizontal: mobileSpacing.medium,
    paddingTop: mobileSpacing.medium,
    gap: mobileSpacing.small,
  },
  toolbar: {
    paddingHorizontal: mobileSpacing.small,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tabs: { paddingHorizontal: mobileSpacing.medium },
  chat: {
    flex: 1,
    minHeight: 160,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.small,
    paddingLeft: mobileSpacing.medium,
    justifyContent: "space-between",
  },
  messages: { gap: mobileSpacing.small, padding: mobileSpacing.medium },
  message: { minHeight: 48, justifyContent: "center" },
  messageText: { color: colors.textPrimary, fontSize: 14, lineHeight: 22 },
  username: { color: "#c7b4dd", fontWeight: "700" },
  badge: { color: colors.textCategory, fontSize: 11 },
  systemMessage: { ...mobileType.label, paddingVertical: mobileSpacing.small },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.small,
    padding: mobileSpacing.small,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  guest: { paddingHorizontal: mobileSpacing.medium },
  messageInput: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    minHeight: 48,
    borderRadius: 8,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
  },
  timeline: { paddingVertical: mobileSpacing.small },
  recording: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: mobileSpacing.medium,
    backgroundColor: colors.surface,
  },
  recordingText: { ...mobileType.label, color: "#ff8299" },
  caption: {
    backgroundColor: colors.overlay,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  captionText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  failedPlayer: { padding: mobileSpacing.medium },
  fullscreen: {
    flex: 1,
    minHeight: 500,
    backgroundColor: "#000000",
    justifyContent: "center",
  },
  fullscreenControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: mobileSpacing.medium,
  },
  mini: {
    width: 224,
    alignSelf: "flex-end",
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    overflow: "hidden",
    gap: mobileSpacing.small,
    paddingBottom: mobileSpacing.small,
  },
  emotes: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  emote: {
    minWidth: 72,
    flexGrow: 1,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: mobileSpacing.small,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
  },
  emoteLabel: { ...mobileType.label, fontSize: 10 },
});
