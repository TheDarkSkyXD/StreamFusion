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
import { defaultChatDisplaySettingsView } from "../domain/chat-display-preferences";
import {
  SettingsCopy,
  SettingsSection,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from "./settings-controls";

const TIMESTAMP_OPTIONS: readonly { value: TimestampFormat; label: string }[] = [
  { value: "H:mm", label: "24-hour (9:05)" },
  { value: "HH:mm", label: "24-hour (09:05)" },
  { value: "H:mm:ss", label: "24-hour (9:05:07)" },
  { value: "HH:mm:ss", label: "24-hour (09:05:07)" },
  { value: "h:mm a", label: "12-hour (9:05 AM)" },
  { value: "hh:mm a", label: "12-hour (09:05 AM)" },
  { value: "h:mm:ss a", label: "12-hour (9:05:07 AM)" },
  { value: "hh:mm:ss a", label: "12-hour (09:05:07 AM)" },
];

const DENSITY_OPTIONS: readonly { value: ChatDensity; label: string }[] = [
  { value: "compact", label: "Tight" },
  { value: "cozy", label: "Medium" },
  { value: "loose", label: "Loose" },
];
const DELETED_OPTIONS: readonly {
  value: DeletedMessageDisplayMode;
  label: string;
}[] = [
  { value: "tombstone", label: "Tombstone only" },
  { value: "message", label: "Message content only" },
  { value: "compact", label: "Full compact detail (recommended)" },
  { value: "audit", label: "Audit-style detail" },
];
const HIGHLIGHT_OPTIONS: readonly {
  value: ModerationHighlightStyle;
  label: string;
}[] = [
  { value: "compact", label: "Compact" },
  { value: "cozy", label: "Framed" },
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
      <SettingsSelect
        current={prefs.timestampFormat}
        label="Timestamp format"
        onSelect={(timestampFormat) => onChange({ timestampFormat })}
        options={TIMESTAMP_OPTIONS}
        testID="chat-timestamp-format"
      />
      <SettingsSlider
        formatValue={(fontSizePx) => `${fontSizePx}px`}
        label="Font size"
        max={20}
        min={10}
        onValueChange={(fontSizePx) => onChange({ fontSizePx })}
        step={1}
        testID="chat-font-size"
        value={prefs.fontSizePx}
      />
      <SettingsSlider
        formatValue={(emoteSizePx) => `${emoteSizePx}px`}
        label="Emote size"
        max={56}
        min={16}
        onValueChange={(emoteSizePx) => onChange({ emoteSizePx })}
        step={1}
        testID="chat-emote-size"
        value={prefs.emoteSizePx}
      />
      <SettingsSelect
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
      <SettingsSlider
        detail="Higher values keep more history in memory."
        formatValue={(messageLimit) => String(messageLimit)}
        label="Message limit"
        max={1000}
        min={100}
        onValueChange={(messageLimit) => onChange({ messageLimit })}
        step={100}
        testID="chat-message-limit"
        value={prefs.messageLimit}
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
        <SettingsSlider
          formatValue={(recentMessagesLimit) => String(recentMessagesLimit)}
          label="Recent messages to load"
          max={800}
          min={100}
          onValueChange={(recentMessagesLimit) =>
            onChange({ recentMessagesLimit })
          }
          step={100}
          testID="chat-recent-limit"
          value={prefs.recentMessagesLimit}
        />
      ) : null}
      <SettingsSelect
        current={prefs.deletedMessageDisplay}
        label="Deleted message display"
        onSelect={(deletedMessageDisplay) =>
          onChange({ deletedMessageDisplay })
        }
        options={DELETED_OPTIONS}
        testID="chat-deleted"
      />
      <SettingsSelect
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
