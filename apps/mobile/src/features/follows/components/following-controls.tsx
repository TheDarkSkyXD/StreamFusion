import { useTranslation } from "react-i18next";
import { StyleSheet, TextInput, View } from "react-native";

import { MobileFilterChip } from "@mobile/design/chip";
import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import {
  mobileTextFieldProps,
  mobileTextFieldStyle,
} from "@mobile/design/text-field";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { FollowingChip, FollowingTab } from "../capabilities/following-session";

const TABS: readonly FollowingTab[] = [
  "live",
  "videos",
  "clips",
  "categories",
  "channels",
];
const CHIPS: readonly FollowingChip[] = ["all", "live", "twitch", "kick"];

export function FollowingControls({
  chip,
  onChip,
  onQuery,
  onTab,
  query,
  tab,
}: {
  readonly chip: FollowingChip;
  readonly onChip: (chip: FollowingChip) => void;
  readonly onQuery: (query: string) => void;
  readonly onTab: (tab: FollowingTab) => void;
  readonly query: string;
  readonly tab: FollowingTab;
}) {
  const { t } = useTranslation();
  const translate = (key: string, values?: Record<string, unknown>) =>
    values === undefined ? t(key) : t(key, values);
  return (
    <View style={styles.stack}>
      <TextInput
        {...mobileTextFieldProps}
        accessibilityLabel={t("discovery.following.searchPlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onQuery}
        placeholder={t("discovery.following.searchPlaceholder")}
        placeholderTextColor={mobileColors.textMuted}
        style={styles.search}
        testID="following-search"
        value={query}
      />
      <View accessibilityLabel={t("discovery.following.filtersA11y")} style={styles.row}>
        {CHIPS.map((value) => (
          <MobileFilterChip
            accessibilityLabel={chipLabel(value, translate)}
            key={value}
            label={chipLabel(value, translate)}
            onPress={() => onChip(value)}
            selected={chip === value}
            testID={`following-chip-${value}`}
          />
        ))}
      </View>
      <MobileUnderlineTabs
        accessibilityLabel={t("discovery.following.contentA11y")}
        onSelect={onTab}
        selectedId={tab}
        tabs={TABS.map((value) => ({
          accessibilityLabel: tabLabel(value, translate),
          id: value,
          label: tabLabel(value, translate),
          testID: `following-tab-${value}`,
        }))}
        testID="following-content-tabs"
      />
    </View>
  );
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

function chipLabel(chip: FollowingChip, t: Translate): string {
  switch (chip) {
    case "all":
      return t("discovery.following.all");
    case "live":
      return t("discovery.following.liveOnly");
    case "twitch":
      return "Twitch";
    case "kick":
      return "Kick";
  }
}

function tabLabel(tab: FollowingTab, t: Translate): string {
  switch (tab) {
    case "live":
      return t("discovery.following.liveLabel");
    case "videos":
      return t("discovery.videos");
    case "clips":
      return t("discovery.clips");
    case "categories":
      return t("discovery.categories");
    case "channels":
      return t("discovery.channels");
  }
}

const styles = StyleSheet.create({
  stack: { gap: mobileSpacing.small },
  search: {
    ...mobileTextFieldStyle,
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
});
