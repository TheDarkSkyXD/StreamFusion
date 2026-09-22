import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Activity,
  ArrowLeft,
  Bell,
  Bug,
  ChevronRight,
  CircleHelp,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  MonitorPlay,
  Palette,
  RefreshCw,
  ShieldBan,
  SlidersHorizontal,
  Target,
  Users,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react-native";
import {
  densityGapMultiplier,
  type SettingsPanelId,
} from "@streamfusion/core/settings";

import { MobileScreenHeader } from "@mobile/design/screen-header";
import {
  mobileColors,
  mobileHitSlop,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { warningHaptic } from "@mobile/design/haptics";
import type { SettingsSession, SettingsView } from "../capabilities/settings";
import {
  SETTINGS_CATEGORY_SECTIONS,
  settingsCategoriesForPanels,
  settingsCategoryTitle,
  type SettingsCategory,
  type SettingsCategoryIconId,
} from "../domain/settings-categories";
import { useSettingsSession } from "./use-settings-session";
import {
  AppearanceSettingsPanel,
  BufferSettingsPanel,
  MultiviewSettingsPanel,
  PlaybackSettingsPanel,
  PlayerControlsSettingsPanel,
} from "./settings-panels";

const CATEGORY_ICONS: Readonly<Record<SettingsCategoryIconId, LucideIcon>> = {
  appearance: Palette,
  playback: MonitorPlay,
  "player-controls": SlidersHorizontal,
  buffer: Gauge,
  multiview: LayoutDashboard,
  chat: MessageSquare,
  predictions: Target,
  notifications: Bell,
  adblock: ShieldBan,
  proxy: Wifi,
  integrations: Users,
  "api-tokens": KeyRound,
  updates: RefreshCw,
  diagnostics: Activity,
  logs: FileText,
  "report-bug": Bug,
  about: CircleHelp,
};

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
  const { t } = useTranslation();
  const [activePanel, setActivePanel] = useState<SettingsPanelId | null>(null);
  const gap = mobileSpacing.medium * densityGapMultiplier(view.preferences.density);

  // Session search query is in-memory and survives Settings remounts. Clear on
  // hub enter so a stale filter (e.g. "lang" after language work) never hides
  // Playback/Chat/Ad-blocking/Proxy and the rest of the Frosty hub.
  useEffect(() => {
    void session.search("");
  }, [session]);

  const openPanel = (panel: SettingsPanelId) => {
    void session.search("");
    setActivePanel(panel);
  };

  const detailPanel =
    activePanel !== null && view.panels.includes(activePanel)
      ? activePanel
      : null;

  useEffect(() => {
    if (detailPanel === null) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setActivePanel(null);
        return true;
      },
    );
    return () => subscription.remove();
  }, [detailPanel]);

  if (detailPanel !== null) {
    return (
      <SettingsCategoryDetail
        extras={extras}
        gap={gap}
        onBack={() => setActivePanel(null)}
        panel={detailPanel}
        session={session}
        view={view}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { gap }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      testID="screen-more-settings"
    >
      <View style={[styles.column, { gap }]} testID="screen-settings">
        <MobileScreenHeader
          summary={t("settings.languageAndAppPreferences")}
          title={t("navigation.settings")}
        />
        <SettingsSearchField session={session} value={view.query} />
        <RejectedNotices messages={view.rejected} />
        <SettingsHub
          onOpenPanel={openPanel}
          view={view}
        />
      </View>
    </ScrollView>
  );
}

export function SettingsCategoryDetail({
  extras,
  gap,
  onBack,
  panel,
  session,
  view,
}: {
  readonly extras: Partial<Record<SettingsPanelId, ReactNode>>;
  readonly gap: number;
  readonly onBack: () => void;
  readonly panel: SettingsPanelId;
  readonly session: SettingsSession;
  readonly view: SettingsView;
}) {
  const title = settingsCategoryTitle(panel);
  return (
    <ScrollView
      contentContainerStyle={[styles.content, { gap }]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      testID={`screen-more-settings-${panel}`}
    >
      <View style={[styles.column, { gap }]}>
        <View style={styles.detailHeader}>
          <Pressable
            accessibilityLabel="Back to settings"
            accessibilityRole="button"
            hitSlop={mobileHitSlop}
            onPress={onBack}
            style={({ pressed }) => [
              styles.backButton,
              pressed ? styles.tilePressed : null,
            ]}
            testID="settings-category-back"
          >
            <ArrowLeft
              accessibilityElementsHidden
              color={mobileColors.textPrimary}
              size={22}
              strokeWidth={2}
            />
          </Pressable>
          <MobileScreenHeader title={title} />
        </View>
        <RejectedNotices messages={view.rejected} />
        <SettingsPanelBody extras={extras} panel={panel} session={session} view={view} />
      </View>
    </ScrollView>
  );
}

export function SettingsHub({
  onOpenPanel,
  view,
}: {
  readonly onOpenPanel: (panel: SettingsPanelId) => void;
  readonly view: SettingsView;
}) {
  const categories = settingsCategoriesForPanels(view.panels);
  const query = view.query.trim();
  return (
    <View style={styles.hub} testID="settings-hub">
      {SETTINGS_CATEGORY_SECTIONS.map((section) => {
        const rows = categories.filter((category) => category.section === section.id);
        if (rows.length === 0) return null;
        return (
          <View key={section.id} style={styles.section}>
            <Text selectable style={styles.sectionTitle}>
              {section.title}
            </Text>
            <View style={styles.tileGroup}>
              {rows.map((category) => (
                <SettingsTileRoute
                  key={category.id}
                  category={category}
                  onPress={() => onOpenPanel(category.id)}
                />
              ))}
            </View>
          </View>
        );
      })}
      {query.length > 0 ? (
        <SettingsSearchMatches
          matches={view.matches}
          onOpenPanel={onOpenPanel}
        />
      ) : null}
      {categories.length === 0 ? (
        <Text selectable style={styles.empty} testID="settings-hub-empty">
          No settings match that search.
        </Text>
      ) : null}
    </View>
  );
}

function SettingsSearchMatches({
  matches,
  onOpenPanel,
}: {
  readonly matches: SettingsView["matches"];
  readonly onOpenPanel: (panel: SettingsPanelId) => void;
}) {
  if (matches.length === 0) return null;
  const limited = matches.slice(0, 8);
  return (
    <View style={styles.section} testID="settings-search-matches">
      <Text selectable style={styles.sectionTitle}>
        Matching controls
      </Text>
      <View style={styles.tileGroup}>
        {limited.map((match) => (
          <Pressable
            key={match.id}
            accessibilityLabel={`Open ${match.label} in ${settingsCategoryTitle(match.panel)}`}
            accessibilityRole="button"
            onPress={() => onOpenPanel(match.panel)}
            style={({ pressed }) => [
              styles.matchRow,
              pressed ? styles.tilePressed : null,
            ]}
            testID={`settings-match-${match.id}`}
          >
            <View style={styles.matchCopy}>
              <Text selectable style={styles.tileTitle}>
                {match.label}
              </Text>
              <Text selectable style={styles.tileDescription}>
                {settingsCategoryTitle(match.panel)}
              </Text>
            </View>
            <ChevronRight
              accessibilityElementsHidden
              color={mobileColors.textMuted}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function SettingsTileRoute({
  category,
  onPress,
}: {
  readonly category: SettingsCategory;
  readonly onPress: () => void;
}) {
  const Icon = CATEGORY_ICONS[category.icon];
  return (
    <Pressable
      accessibilityLabel={category.title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed ? styles.tilePressed : null]}
      testID={`settings-category-${category.id}`}
    >
      <View style={styles.tileIconWell}>
        <Icon
          accessibilityElementsHidden
          color={mobileColors.textPrimary}
          size={20}
          strokeWidth={2}
        />
      </View>
      <View style={styles.tileCopy}>
        <Text selectable style={styles.tileTitle}>
          {category.title}
        </Text>
        <Text selectable style={styles.tileDescription}>
          {category.description}
        </Text>
      </View>
      <ChevronRight
        accessibilityElementsHidden
        color={mobileColors.textMuted}
        size={20}
        strokeWidth={2}
      />
    </Pressable>
  );
}

function SettingsPanelBody({
  extras,
  panel,
  session,
  view,
}: {
  readonly extras: Partial<Record<SettingsPanelId, ReactNode>>;
  readonly panel: SettingsPanelId;
  readonly session: SettingsSession;
  readonly view: SettingsView;
}) {
  if (isProductPanel(panel)) {
    const Panel = PRODUCT_PANELS[panel];
    return (
      <SettingsPanelFrame panel={panel}>
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
  if (!extra) {
    return (
      <Text selectable style={styles.empty} testID={`settings-panel-missing-${panel}`}>
        This category is not available on this build.
      </Text>
    );
  }
  return <SettingsPanelFrame panel={panel}>{extra}</SettingsPanelFrame>;
}

function SettingsSearchField({
  session,
  value,
}: {
  readonly session: SettingsSession;
  readonly value: string;
}) {
  const hasQuery = value.trim().length > 0;
  return (
    <View style={styles.searchRow}>
      <TextInput
        accessibilityLabel="Search settings"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(query) => {
          void session.search(query);
        }}
        placeholder="Search appearance, chat, predictions, integrations…"
        placeholderTextColor={mobileColors.textMuted}
        style={styles.search}
        testID="settings-search"
        value={value}
      />
      {hasQuery ? (
        <Pressable
          accessibilityLabel="Clear settings search"
          hitSlop={mobileHitSlop}
          accessibilityRole="button"
          onPress={() => {
            void warningHaptic();
            void session.search("");
          }}
          style={({ pressed }) => [
            styles.searchClear,
            pressed ? styles.tilePressed : null,
          ]}
          testID="settings-search-clear"
        >
          <X
            accessibilityElementsHidden
            color={mobileColors.textSecondary}
            size={18}
            strokeWidth={2}
          />
        </Pressable>
      ) : null}
    </View>
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

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: mobileColors.background,
  },
  content: {
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  column: {
    width: "100%",
  },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  search: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    color: mobileColors.textPrimary,
    flex: 1,
    fontSize: 16,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  searchClear: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    height: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    width: mobileSizing.minimumTouchTarget,
  },
  rejected: {
    color: mobileColors.live,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  hub: {
    gap: mobileSpacing.large,
  },
  section: {
    gap: mobileSpacing.small,
  },
  sectionTitle: {
    ...mobileType.label,
    color: mobileColors.textMuted,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  tileGroup: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
  },
  tile: {
    alignItems: "center",
    borderBottomColor: mobileColors.dividerMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget + 8,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small + 2,
  },
  tilePressed: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  tileIconWell: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  tileCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  tileTitle: {
    ...mobileType.title,
    fontSize: 15,
    lineHeight: 20,
  },
  tileDescription: {
    ...mobileType.caption,
    color: mobileColors.textSecondary,
  },
  matchRow: {
    alignItems: "center",
    borderBottomColor: mobileColors.dividerMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  matchCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  detailHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  backButton: {
    alignItems: "center",
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    height: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    marginTop: 2,
    width: mobileSizing.minimumTouchTarget,
  },
  empty: {
    ...mobileType.body,
    color: mobileColors.textSecondary,
  },
});
