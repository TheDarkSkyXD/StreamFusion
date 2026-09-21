import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  densityGapMultiplier,
  type SettingsPanelId,
} from "@streamfusion/core/settings";

import { MobileScreenHeader } from "@mobile/design/screen-header";
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

const PRODUCT_PANELS = {
  appearance: AppearanceSettingsPanel,
  buffer: BufferSettingsPanel,
  multiview: MultiviewSettingsPanel,
  playback: PlaybackSettingsPanel,
  "player-controls": PlayerControlsSettingsPanel,
} as const;

type ProductPanelId = keyof typeof PRODUCT_PANELS;

function SettingsPanelFrame({
  children,
  panel,
}: {
  readonly children: ReactNode;
  readonly panel: SettingsPanelId;
}) {
  return <View testID={`screen-settings-${panel}`}>{children}</View>;
}

function isProductPanel(panel: SettingsPanelId): panel is ProductPanelId {
  return panel in PRODUCT_PANELS;
}

export function SettingsWorkspace({
  extras = {},
  session,
}: {
  readonly extras?: Partial<Record<SettingsPanelId, ReactNode>>;
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
        <MobileScreenHeader title="Settings" />
        <SettingsSearchField session={session} value={view.query} />
        <RejectedNotices messages={view.rejected} />
        <VisibleSettingsPanels extras={extras} session={session} view={view} />
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
      placeholder="Search appearance, chat, predictions, integrations, token"
      placeholderTextColor={mobileColors.textMuted}
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
  extras,
  session,
  view,
}: {
  readonly extras: Partial<Record<SettingsPanelId, ReactNode>>;
  readonly session: SettingsSession;
  readonly view: SettingsView;
}) {
  return (
    <>
      {view.panels.map((panel) => {
        if (isProductPanel(panel)) {
          const Panel = PRODUCT_PANELS[panel];
          return (
            <SettingsPanelFrame key={panel} panel={panel}>
              <Panel
                onChange={(patch) => {
                  void session.apply(patch);
                }}
                view={view}
              />
            </SettingsPanelFrame>
          );
        }
        const extra = extras[panel];
        if (!extra) return null;
        return (
          <SettingsPanelFrame key={panel} panel={panel}>
            {extra}
          </SettingsPanelFrame>
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
