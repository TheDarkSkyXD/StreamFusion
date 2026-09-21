import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { mobileColors, mobileSpacing } from "@mobile/design/tokens";

import type {
  ChatDisplayPreferences,
  ChatDisplayPreferencePatch,
  ChatDisplaySettingsSession,
  ChatDisplaySettingsView,
  ChatDensity,
  DeletedMessageDisplayMode,
  ModerationHighlightStyle,
  TimestampFormat,
} from "../capabilities/chat-display-settings";
import {
  CHAT_EMOTE_SIZE_OPTIONS,
  CHAT_FONT_SIZE_OPTIONS,
  CHAT_MESSAGE_LIMIT_OPTIONS,
  CHAT_RECENT_LIMIT_OPTIONS,
  defaultChatDisplaySettingsView,
} from "../domain/chat-display-preferences";
import {
  SettingsChoiceRow,
  SettingsCopy,
  SettingsSection,
  SettingsSwitch,
} from "./settings-controls";

const TIMESTAMP_OPTIONS: readonly TimestampFormat[] = [
  "H:mm",
  "HH:mm",
  "H:mm:ss",
  "HH:mm:ss",
  "h:mm a",
  "hh:mm a",
  "h:mm:ss a",
  "hh:mm:ss a",
];

const DENSITY_OPTIONS: readonly ChatDensity[] = ["compact", "cozy", "loose"];
const DELETED_OPTIONS: readonly DeletedMessageDisplayMode[] = [
  "tombstone",
  "message",
  "compact",
  "audit",
];
const HIGHLIGHT_OPTIONS: readonly ModerationHighlightStyle[] = [
  "compact",
  "cozy",
];

const APPEARANCE_TOGGLES = [
  {
    field: "readableColorForUncolored",
    label: "Readable username colors",
    testID: "chat-readable-color",
  },
  {
    field: "themeAdaptUsernameColor",
    label: "Adapt username colors",
    testID: "chat-theme-adapt",
  },
  { field: "timestamps", label: "Show timestamps", testID: "chat-timestamps" },
] as const;

const EMOTE_TOGGLES = [
  { field: "enable7tv", label: "7TV emotes", testID: "chat-emotes-7tv" },
  { field: "enableBttv", label: "BTTV emotes", testID: "chat-emotes-bttv" },
  { field: "enableFfz", label: "FFZ emotes", testID: "chat-emotes-ffz" },
  {
    field: "enable7tvBadges",
    label: "7TV badges",
    testID: "chat-badges-7tv",
  },
  {
    field: "enableBttvBadges",
    label: "BTTV badges",
    testID: "chat-badges-bttv",
  },
  { field: "enableFfzBadges", label: "FFZ badges", testID: "chat-badges-ffz" },
  {
    field: "enable7tvUsernamePaints",
    label: "7TV username paints",
    testID: "chat-paints",
  },
  {
    field: "animatedEmotes",
    label: "Animated emotes",
    testID: "chat-animated-emotes",
  },
  {
    field: "overlayEmotes",
    label: "Overlay emotes",
    testID: "chat-overlay-emotes",
  },
  {
    field: "systemMessageEmotes",
    label: "Emotes in system messages",
    testID: "chat-system-emotes",
  },
] as const;

const EVENT_TOGGLES = [
  {
    field: "recentMessagesOnJoin",
    label: "Load recent messages on join",
    testID: "chat-recent-on-join",
  },
  {
    field: "showUserNotices",
    label: "Show sub and raid notices",
    testID: "chat-user-notices",
  },
  {
    field: "showClearMsg",
    label: "Show deleted message notices",
    testID: "chat-clear-msg",
  },
  {
    field: "showClearChat",
    label: "Show chat cleared notices",
    testID: "chat-clear",
  },
  {
    field: "firstMsgHighlight",
    label: "Highlight first-time chatters",
    testID: "chat-first-msg",
  },
  { field: "showPolls", label: "Show polls", testID: "chat-polls" },
  {
    field: "showPredictions",
    label: "Show predictions in chat",
    testID: "chat-predictions-events",
  },
] as const;

export function ChatSettingsPanel({
  session,
}: {
  readonly session: ChatDisplaySettingsSession;
}) {
  const [view, setView] = useState<ChatDisplaySettingsView>(
    defaultChatDisplaySettingsView(),
  );
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      setView(session.peek());
    });
    void session.load().then(setView);
    return unsubscribe;
  }, [session]);
  return (
    <ChatSettingsView
      onChange={(patch) => {
        void session.apply(patch).then(setView);
      }}
      view={view}
    />
  );
}

export function ChatSettingsView({
  onChange,
  view,
}: {
  readonly onChange: (patch: ChatDisplayPreferencePatch) => void;
  readonly view: ChatDisplaySettingsView;
}) {
  const prefs = view.preferences;
  return (
    <View style={styles.stack}>
      <SettingsSection testID="panel-chat" title="CHAT">
        <SettingsCopy testID="chat-disclosure" value={view.disclosure} />
        <AppearanceRows onChange={onChange} prefs={prefs} />
        <EmoteRows onChange={onChange} prefs={prefs} />
        <EventRows onChange={onChange} prefs={prefs} />
      </SettingsSection>
    </View>
  );
}

function AppearanceRows({
  onChange,
  prefs,
}: {
  readonly onChange: (patch: ChatDisplayPreferencePatch) => void;
  readonly prefs: ChatDisplayPreferences;
}) {
  return (
    <>
      <Text selectable style={styles.group}>
        Appearance
      </Text>
      {APPEARANCE_TOGGLES.map((row) => (
        <SettingsSwitch
          key={row.field}
          checked={prefs[row.field]}
          label={row.label}
          onToggle={() => onChange({ [row.field]: !prefs[row.field] })}
          testID={row.testID}
        />
      ))}
      <SettingsChoiceRow
        current={prefs.timestampFormat}
        label="Timestamp format"
        onSelect={(timestampFormat) => onChange({ timestampFormat })}
        options={TIMESTAMP_OPTIONS}
        testID="chat-timestamp-format"
      />
      <SettingsChoiceRow
        current={prefs.fontSizePx}
        label="Font size"
        onSelect={(fontSizePx) => onChange({ fontSizePx })}
        options={CHAT_FONT_SIZE_OPTIONS}
        testID="chat-font-size"
      />
      <SettingsChoiceRow
        current={prefs.emoteSizePx}
        label="Emote size"
        onSelect={(emoteSizePx) => onChange({ emoteSizePx })}
        options={CHAT_EMOTE_SIZE_OPTIONS}
        testID="chat-emote-size"
      />
      <SettingsChoiceRow
        current={prefs.density}
        label="Chat density"
        onSelect={(density) => onChange({ density })}
        options={DENSITY_OPTIONS}
        testID="chat-density"
      />
    </>
  );
}

function EmoteRows({
  onChange,
  prefs,
}: {
  readonly onChange: (patch: ChatDisplayPreferencePatch) => void;
  readonly prefs: ChatDisplayPreferences;
}) {
  return (
    <>
      <Text selectable style={styles.group}>
        Emotes and badges
      </Text>
      <SettingsCopy
        testID="chat-emote-note"
        value="Provider toggles apply on the next channel load."
      />
      {EMOTE_TOGGLES.map((row) => (
        <SettingsSwitch
          key={row.field}
          checked={prefs[row.field]}
          label={row.label}
          onToggle={() => onChange({ [row.field]: !prefs[row.field] })}
          testID={row.testID}
        />
      ))}
    </>
  );
}

function EventRows({
  onChange,
  prefs,
}: {
  readonly onChange: (patch: ChatDisplayPreferencePatch) => void;
  readonly prefs: ChatDisplayPreferences;
}) {
  return (
    <>
      <Text selectable style={styles.group}>
        Messages and events
      </Text>
      <SettingsChoiceRow
        current={prefs.messageLimit}
        label="Message limit"
        onSelect={(messageLimit) => onChange({ messageLimit })}
        options={CHAT_MESSAGE_LIMIT_OPTIONS}
        testID="chat-message-limit"
      />
      {EVENT_TOGGLES.map((row) => (
        <SettingsSwitch
          key={row.field}
          checked={prefs[row.field]}
          label={row.label}
          onToggle={() => onChange({ [row.field]: !prefs[row.field] })}
          testID={row.testID}
        />
      ))}
      {prefs.recentMessagesOnJoin ? (
        <SettingsChoiceRow
          current={prefs.recentMessagesLimit}
          label="Recent messages to load"
          onSelect={(recentMessagesLimit) => onChange({ recentMessagesLimit })}
          options={CHAT_RECENT_LIMIT_OPTIONS}
          testID="chat-recent-limit"
        />
      ) : null}
      <SettingsChoiceRow
        current={prefs.deletedMessageDisplay}
        label="Deleted message display"
        onSelect={(deletedMessageDisplay) =>
          onChange({ deletedMessageDisplay })
        }
        options={DELETED_OPTIONS}
        testID="chat-deleted"
      />
      <SettingsChoiceRow
        current={prefs.moderationHighlightStyle}
        label="Moderation highlight style"
        onSelect={(moderationHighlightStyle) =>
          onChange({ moderationHighlightStyle })
        }
        options={HIGHLIGHT_OPTIONS}
        testID="chat-mod-highlight"
      />
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: mobileSpacing.small,
  },
  group: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    lineHeight: 16,
    marginTop: mobileSpacing.small,
  },
});
