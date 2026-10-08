import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react-native";
import type { ClipTimeRange } from "@streamfusion/core/discovery";

import { MobileFilterChip } from "@mobile/design/chip";
import { MobileSelect, type MobileSelectOption } from "@mobile/design/select";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import {
  BROADCAST_LANGUAGES,
  languageLabel,
  type LanguageFilter,
} from "../domain/broadcast-languages";
import type {
  CategoryRequestIdentity,
  ClipSort,
  LiveSort,
  PlatformScope,
  VideoSort,
} from "../domain/category-identity";

export function CategoryFilterBar({
  identity,
  onChange,
}: {
  readonly identity: CategoryRequestIdentity;
  readonly onChange: (next: CategoryRequestIdentity) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const platform =
    identity.platformScope === "all"
      ? "All platforms"
      : identity.platformScope === "twitch"
        ? "Twitch"
        : "Kick";
  const language =
    identity.language === "all"
      ? "All languages"
      : languageLabel(identity.language);
  const sort =
    identity.tab === "live"
      ? liveSortOptions.find((option) => option.value === identity.liveSort)
          ?.label
      : identity.tab === "clips"
        ? clipSortOptions.find((option) => option.value === identity.clipSort)
            ?.label
        : videoSortOptions.find((option) => option.value === identity.videoSort)
            ?.label;
  const summary = [
    platform,
    language,
    sort,
    ...(identity.tab === "live" && identity.tag !== "all"
      ? [identity.tag]
      : []),
    ...(identity.tab === "clips"
      ? [
          clipTimeOptions().find(
            (option) => option.value === identity.clipTimeRange,
          )?.label,
        ]
      : []),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.stack}>
      <Pressable
        accessibilityLabel={`Filters, ${summary}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [
          styles.toggle,
          pressed ? styles.togglePressed : null,
        ]}
        testID="category-filters-toggle"
      >
        <SlidersHorizontal color={mobileColors.textSecondary} size={22} />
        <View style={styles.toggleCopy}>
          <Text style={styles.toggleTitle}>Filters</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        {expanded ? (
          <ChevronUp color={mobileColors.textSecondary} size={20} />
        ) : (
          <ChevronDown color={mobileColors.textSecondary} size={20} />
        )}
      </Pressable>
      {expanded ? (
        <View style={styles.stack}>
          <ChipRow
            label="Platform"
            options={platformOptions(identity)}
            selected={identity.platformScope}
            testID="category-platform"
            onSelect={(platformScope) =>
              onChange({ ...identity, platformScope })
            }
          />
          <MobileSelect<LanguageFilter>
            accessibilityLabel="Language"
            appearance="row"
            options={languageOptions()}
            value={identity.language}
            testID="category-language"
            onChange={(language) => onChange({ ...identity, language })}
          />
          {identity.tab === "live" && identity.tag !== "all" ? (
            <ChipRow
              label="Tag"
              options={tagOptions(identity)}
              selected={identity.tag}
              testID="category-tag"
              onSelect={(tag) => onChange({ ...identity, tag })}
            />
          ) : null}
          {identity.tab === "live" ? (
            <MobileSelect<LiveSort>
              accessibilityLabel="Sort"
              appearance="row"
              options={liveSortOptions}
              value={identity.liveSort}
              testID="category-sort"
              onChange={(liveSort) => onChange({ ...identity, liveSort })}
            />
          ) : identity.tab === "clips" ? (
            <MobileSelect<ClipSort>
              accessibilityLabel="Sort"
              appearance="row"
              options={clipSortOptions}
              value={identity.clipSort}
              testID="category-sort"
              onChange={(clipSort) => onChange({ ...identity, clipSort })}
            />
          ) : (
            <MobileSelect<VideoSort>
              accessibilityLabel="Sort"
              appearance="row"
              options={videoSortOptions}
              value={identity.videoSort}
              testID="category-sort"
              onChange={(videoSort) => onChange({ ...identity, videoSort })}
            />
          )}
          {identity.tab === "clips" ? (
            <ChipRow
              label="Time"
              options={clipTimeOptions()}
              selected={identity.clipTimeRange}
              testID="category-clip-time"
              onSelect={(clipTimeRange) =>
                onChange({ ...identity, clipTimeRange })
              }
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ChipRow<T extends string>({
  label,
  onSelect,
  options,
  selected,
  testID,
}: {
  readonly label: string;
  readonly onSelect: (value: T) => void;
  readonly options: readonly { readonly label: string; readonly value: T }[];
  readonly selected: T;
  readonly testID: string;
}) {
  return (
    <View style={styles.group}>
      <Text selectable style={styles.groupLabel}>
        {label}
      </Text>
      <View style={styles.row}>
        {options.map((option) => (
          <MobileFilterChip
            accessibilityLabel={`${label} ${option.label}`}
            key={option.value}
            label={option.label}
            onPress={() => onSelect(option.value)}
            selected={option.value === selected}
            testID={`${testID}-${option.value}`}
          />
        ))}
      </View>
    </View>
  );
}

function platformOptions(
  identity: CategoryRequestIdentity,
): readonly { readonly label: string; readonly value: PlatformScope }[] {
  if (identity.category.otherId === undefined) {
    return [
      {
        label: identity.category.platform === "twitch" ? "Twitch" : "Kick",
        value: identity.category.platform,
      },
    ];
  }
  return [
    { label: "All", value: "all" },
    { label: "Twitch", value: "twitch" },
    { label: "Kick", value: "kick" },
  ];
}

function languageOptions(): readonly {
  readonly label: string;
  readonly value: LanguageFilter;
}[] {
  return [
    { label: "All languages", value: "all" },
    ...BROADCAST_LANGUAGES.map((language) => ({
      label: languageLabel(language),
      value: language,
    })),
  ];
}

function tagOptions(identity: CategoryRequestIdentity): readonly {
  readonly label: string;
  readonly value: string;
}[] {
  return [
    { label: "All tags", value: "all" },
    ...(identity.tag === "all"
      ? []
      : [{ label: identity.tag, value: identity.tag }]),
  ];
}

const liveSortOptions: readonly MobileSelectOption<LiveSort>[] = [
  { label: "Most viewers", value: "viewers-desc" },
  { label: "Fewest viewers", value: "viewers-asc" },
];

const clipSortOptions: readonly MobileSelectOption<ClipSort>[] = [
  { label: "Views", value: "views" },
  { label: "Most Recent", value: "recent" },
];

const videoSortOptions: readonly MobileSelectOption<VideoSort>[] = [
  { label: "Most Recent", value: "recent" },
  { label: "Views", value: "views" },
];

function clipTimeOptions(): readonly {
  readonly label: string;
  readonly value: ClipTimeRange;
}[] {
  return [
    { label: "All Time", value: "all" },
    { label: "Last Day", value: "day" },
    { label: "Last Week", value: "week" },
    { label: "Last Month", value: "month" },
  ];
}

const styles = StyleSheet.create({
  toggle: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget,
    padding: mobileSpacing.small,
  },
  toggleCopy: { flex: 1, minWidth: 0, gap: mobileSpacing.xSmall },
  toggleTitle: { ...mobileType.body, color: mobileColors.textPrimary },
  summary: { fontSize: 12, lineHeight: 18, color: mobileColors.textSecondary },
  togglePressed: { backgroundColor: mobileColors.surfaceRaised },
  stack: {
    gap: mobileSpacing.medium,
  },
  group: {
    gap: mobileSpacing.small,
  },
  groupLabel: {
    color: mobileColors.textCategory,
    fontSize: 13,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
});
