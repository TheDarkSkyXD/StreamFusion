import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ClipTimeRange } from "@streamfusion/core/discovery";

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
  CategoryTab,
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
  return (
    <View style={styles.stack}>
      <ChipRow
        label="Platform"
        options={platformOptions(identity)}
        selected={identity.platformScope}
        testID="category-platform"
        onSelect={(platformScope) => onChange({ ...identity, platformScope })}
      />
      <ChipRow
        label="Language"
        options={languageOptions()}
        selected={identity.language}
        testID="category-language"
        onSelect={(language) => onChange({ ...identity, language })}
      />
      {identity.tab === "live" ? (
        <ChipRow
          label="Tags"
          options={tagOptions(identity)}
          selected={identity.tag}
          testID="category-tag"
          onSelect={(tag) => onChange({ ...identity, tag })}
        />
      ) : null}
      <ChipRow
        label="Sort"
        options={sortOptions(identity.tab)}
        selected={sortValue(identity)}
        testID="category-sort"
        onSelect={(value) => onChange(applySort(identity, value))}
      />
      {identity.tab === "clips" ? (
        <ChipRow
          label="Clip time"
          options={clipTimeOptions()}
          selected={identity.clipTimeRange}
          testID="category-clip-time"
          onSelect={(clipTimeRange) =>
            onChange({ ...identity, clipTimeRange })
          }
        />
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
          <Pressable
            accessibilityLabel={`${label} ${option.label}`}
            accessibilityRole="button"
            accessibilityState={{ selected: option.value === selected }}
            key={option.value}
            onPress={() => onSelect(option.value)}
            style={[
              styles.chip,
              option.value === selected ? styles.chipSelected : null,
            ]}
            testID={`${testID}-${option.value}`}
          >
            <Text selectable style={styles.chipLabel}>
              {option.label}
            </Text>
          </Pressable>
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
    { label: "All", value: "all" },
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
    ...(identity.tag === "all" ? [] : [{ label: identity.tag, value: identity.tag }]),
  ];
}

function sortOptions(tab: CategoryTab): readonly {
  readonly label: string;
  readonly value: string;
}[] {
  if (tab === "live") {
    return [
      { label: "Viewers", value: "viewers-desc" },
      { label: "Viewers (low)", value: "viewers-asc" },
    ];
  }
  if (tab === "clips") return [{ label: "Views", value: "views" }];
  return [
    { label: "Recent", value: "recent" },
    { label: "Views", value: "views" },
  ];
}

function clipTimeOptions(): readonly {
  readonly label: string;
  readonly value: ClipTimeRange;
}[] {
  return [
    { label: "All time", value: "all" },
    { label: "Day", value: "day" },
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
  ];
}

function sortValue(identity: CategoryRequestIdentity): string {
  if (identity.tab === "live") return identity.liveSort;
  if (identity.tab === "clips") return identity.clipSort;
  return identity.videoSort;
}

function applySort(
  identity: CategoryRequestIdentity,
  value: string,
): CategoryRequestIdentity {
  if (identity.tab === "live") {
    return { ...identity, liveSort: value as LiveSort };
  }
  if (identity.tab === "videos") {
    return { ...identity, videoSort: value as VideoSort };
  }
  return identity;
}

const styles = StyleSheet.create({
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
  chip: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  chipSelected: {
    backgroundColor: mobileColors.navigationSelected,
  },
  chipLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
});
