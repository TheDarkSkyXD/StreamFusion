import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { densityGapMultiplier } from "@streamfusion/core/settings";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { SettingsSession, SettingsView } from "../capabilities/settings";
import { useSettingsSession } from "./use-settings-session";
import {
  AppearanceSettingsPanel,
  BufferSettingsPanel,
  MultiviewSettingsPanel,
  PlaybackSettingsPanel,
  PlayerControlsSettingsPanel,
} from "./settings-panels";

const PANELS = {
  appearance: AppearanceSettingsPanel,
  buffer: BufferSettingsPanel,
  multiview: MultiviewSettingsPanel,
  playback: PlaybackSettingsPanel,
  "player-controls": PlayerControlsSettingsPanel,
} as const;

export function SettingsWorkspace({
  children,
  session,
}: {
  readonly children?: ReactNode;
  readonly session: SettingsSession;
}) {
  const { view } = useSettingsSession(session);
  const gap = mobileSpacing.medium * densityGapMultiplier(view.preferences.density);
  return (
    <ScrollView
      contentContainerStyle={[styles.content, { gap }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      testID="screen-more-settings"
    >
      <View style={[styles.column, { gap }]} testID="screen-settings">
        <Text selectable style={styles.title}>
          Settings
        </Text>
        <SettingsSearchField session={session} value={view.query} />
        <RejectedNotices messages={view.rejected} />
        <VisibleSettingsPanels session={session} view={view} />
        {children}
      </View>
    </ScrollView>
  );
}

function SettingsSearchField({
  session,
  value,
}: {
  readonly session: SettingsSession;
  readonly value: string;
}) {
  return (
    <TextInput
      accessibilityLabel="Search settings"
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={(query) => {
        void session.search(query);
      }}
      placeholder="Search appearance, playback, player, buffer"
      placeholderTextColor={mobileColors.textSecondary}
      style={styles.search}
      testID="settings-search"
      value={value}
    />
  );
}

function RejectedNotices({ messages }: { readonly messages: readonly string[] }) {
  return (
    <>
      {messages.map((message) => (
        <Text key={message} selectable style={styles.rejected} testID="settings-rejected">
          {message}
        </Text>
      ))}
    </>
  );
}

function VisibleSettingsPanels({
  session,
  view,
}: {
  readonly session: SettingsSession;
  readonly view: SettingsView;
}) {
  return (
    <>
      {view.panels.map((panel) => {
        const Panel = PANELS[panel];
        return (
          <View key={panel} testID={`screen-settings-${panel}`}>
            <Panel
              onChange={(patch) => {
                void session.apply(patch);
              }}
              view={view}
            />
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: mobileColors.background,
  },
  content: {
    padding: mobileSpacing.medium,
  },
  column: {
    width: "100%",
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  search: {
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    color: mobileColors.textPrimary,
    fontSize: 16,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  rejected: {
    color: mobileColors.live,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
