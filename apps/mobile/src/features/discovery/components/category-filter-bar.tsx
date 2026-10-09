import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SlidersHorizontal } from "lucide-react-native";
import type { ClipTimeRange } from "@streamfusion/core/discovery";

import { MobileFilterChip } from "@mobile/design/chip";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileSelect, type MobileSelectOption } from "@mobile/design/select";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
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
import { defaultCategoryRequest } from "../domain/category-identity";

export function CategoryFilterBar({
  availableTags = [],
  identity,
  onChange,
}: {
  readonly availableTags?: readonly string[];
  readonly identity: CategoryRequestIdentity;
  readonly onChange: (next: CategoryRequestIdentity) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(identity);
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
    <View style={styles.filterBar}>
      <Pressable
        accessibilityLabel={`Filters, ${summary}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          setDraft(identity);
          setExpanded(true);
        }}
        style={({ pressed }) => [
          styles.toggle,
          pressed ? styles.togglePressed : null,
        ]}
        testID="category-filters-toggle"
      >
        <SlidersHorizontal color={mobileColors.textPrimary} size={20} />
      </Pressable>
      <Text numberOfLines={1} style={styles.summary}>
        {summary}
      </Text>
      <MobileBottomSheet
        footer={
          <View style={styles.actions}>
            <MobileButton
              accessibilityLabel="Reset category filters"
              onPress={() =>
                setDraft({
                  ...defaultCategoryRequest(draft.category, "all", "all"),
                  tab: draft.tab,
                })
              }
              testID="category-filters-reset"
              variant="secondary"
            >
              Reset
            </MobileButton>
            <MobileButton
              accessibilityLabel="Apply category filters"
              onPress={() => {
                onChange(draft);
                setExpanded(false);
              }}
              testID="category-filters-apply"
              variant="primary"
            >
              Apply
            </MobileButton>
          </View>
        }
        onDismiss={() => setExpanded(false)}
        size="expanded"
        testID="category-filters"
        title="Filters"
        visible={expanded}
      >
        <View style={styles.stack}>
          <ChipRow
            label="Platform"
            options={platformOptions(draft)}
            selected={draft.platformScope}
            testID="category-platform"
            onSelect={(platformScope) => setDraft({ ...draft, platformScope })}
          />
          {draft.tab === "live" ? (
            <MobileSelect<LanguageFilter>
              accessibilityLabel="Language"
              appearance="row"
              options={languageOptions()}
              value={draft.language}
              testID="category-language"
              onChange={(language) => setDraft({ ...draft, language })}
            />
          ) : null}
          {draft.tab === "live" &&
          (availableTags.length > 0 || draft.tag !== "all") ? (
            <ChipRow
              label="Tag"
              options={tagOptions(draft, availableTags)}
              selected={draft.tag}
              testID="category-tag"
              onSelect={(tag) => setDraft({ ...draft, tag })}
            />
          ) : null}
          {draft.tab === "live" ? (
            <MobileSelect<LiveSort>
              accessibilityLabel="Sort"
              appearance="row"
              options={liveSortOptions}
              value={draft.liveSort}
              testID="category-sort"
              onChange={(liveSort) => setDraft({ ...draft, liveSort })}
            />
          ) : draft.tab === "clips" ? (
            <MobileSelect<ClipSort>
              accessibilityLabel="Sort"
              appearance="row"
              options={clipSortOptions}
              value={draft.clipSort}
              testID="category-sort"
              onChange={(clipSort) => setDraft({ ...draft, clipSort })}
            />
          ) : (
            <MobileSelect<VideoSort>
              accessibilityLabel="Sort"
              appearance="row"
              options={videoSortOptions}
              value={draft.videoSort}
              testID="category-sort"
              onChange={(videoSort) => setDraft({ ...draft, videoSort })}
            />
          )}
          {draft.tab === "clips" ? (
            <ChipRow
              label="Time"
              options={clipTimeOptions()}
              selected={draft.clipTimeRange}
              testID="category-clip-time"
              onSelect={(clipTimeRange) =>
                setDraft({ ...draft, clipTimeRange })
              }
            />
          ) : null}
        </View>
      </MobileBottomSheet>
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

function tagOptions(
  identity: CategoryRequestIdentity,
  availableTags: readonly string[],
): readonly {
  readonly label: string;
  readonly value: string;
}[] {
  return [
    { label: "All tags", value: "all" },
    ...[
      ...new Set([
        ...availableTags,
        ...(identity.tag === "all" ? [] : [identity.tag]),
      ]),
    ]
      .sort((left, right) => left.localeCompare(right))
      .map((tag) => ({ label: tag, value: tag })),
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
  filterBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  actions: { flexDirection: "row", justifyContent: "space-between" },
  toggle: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  summary: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: mobileColors.textSecondary,
  },
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
