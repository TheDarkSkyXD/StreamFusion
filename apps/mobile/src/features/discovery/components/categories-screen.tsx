import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoveryFixtureMode,
  DiscoverySession,
} from "../capabilities/platform-reads";
import { composeCategoryCatalog } from "../domain/category-catalog";
import { fixtureOutcome } from "../domain/discovery-fixture";
import type { CategoryIdentity } from "../domain/category-identity";
import { identityFromCategory } from "../domain/category-identity";
import {
  BROADCAST_LANGUAGES,
  languageLabel,
  type LanguageFilter,
} from "../domain/broadcast-languages";

import { CategoryCard } from "./category-card";
import { CategoryDiscoveryProofControls } from "./category-discovery-proof-controls";
import { DiscoverySearchDock } from "./discovery-search-dock";
import { HomeProviderBanner } from "./home-provider-banner";
import { useCategoryCatalog } from "./use-category-catalog";

export function CategoriesScreen({
  onOpenAccounts,
  onOpenCategory,
  preferences,
  session,
}: {
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory: (category: CategoryIdentity) => void;
  readonly preferences: DiscoveryPreferenceStore;
  readonly session: DiscoverySession;
}) {
  const [mode, setMode] = useState<DiscoveryFixtureMode>("live");
  const [query, setQuery] = useState("");
  const live = useCategoryCatalog({
    enabled: mode === "live",
    preferences,
    query,
    session,
  });
  const view =
    mode === "live"
      ? live.view
      : composeCategoryCatalog({
          kick: categoryFixture("kick", mode),
          language: live.view.language,
          loading: mode === "loading",
          query,
          twitch: categoryFixture("twitch", mode),
        });
  return (
    <CategoriesView
      onChangeLanguage={live.setLanguage}
      onChangeQuery={setQuery}
      onOpenAccounts={onOpenAccounts}
      onOpenCategory={onOpenCategory}
      onRetry={live.retry}
      view={view}
      {...(__DEV__
        ? { onSelectProofMode: setMode, proofMode: mode }
        : {})}
    />
  );
}

export function CategoriesView({
  onChangeLanguage,
  onChangeQuery,
  onOpenAccounts,
  onOpenCategory,
  onRetry,
  onSelectProofMode,
  proofMode,
  view,
}: {
  readonly onChangeLanguage: (language: LanguageFilter) => void;
  readonly onChangeQuery: (query: string) => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory: (category: CategoryIdentity) => void;
  readonly onRetry: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly view: ReturnType<typeof composeCategoryCatalog>;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="categories-screen"
    >
      <Text accessibilityRole="header" selectable style={styles.title}>
        Categories
      </Text>
      <Text selectable style={styles.summary} testID="categories-phase">
        {phaseCopy(view.phase)}
      </Text>
      <LanguageRow
        language={view.language}
        onChangeLanguage={onChangeLanguage}
      />
      {proofMode && onSelectProofMode ? (
        <CategoryDiscoveryProofControls
          mode={proofMode}
          onSelect={onSelectProofMode}
        />
      ) : null}
      <HomeProviderBanner
        onOpenAccounts={onOpenAccounts}
        onRetry={onRetry}
        outcome={view.providers.twitch}
      />
      <HomeProviderBanner
        onOpenAccounts={onOpenAccounts}
        onRetry={onRetry}
        outcome={view.providers.kick}
      />
      <View style={styles.grid}>
        {view.categories.map((category) => (
          <CategoryCard
            category={category}
            key={`${category.platform}:${category.id}`}
            onPress={() => onOpenCategory(identityFromCategory(category))}
          />
        ))}
      </View>
      <DiscoverySearchDock
        onChangeQuery={onChangeQuery}
        placeholder="Search categories"
        query={view.query}
        testID="categories-search"
      />
    </ScrollView>
  );
}

function LanguageRow({
  language,
  onChangeLanguage,
}: {
  readonly language: LanguageFilter;
  readonly onChangeLanguage: (language: LanguageFilter) => void;
}) {
  const options: readonly LanguageFilter[] = ["all", ...BROADCAST_LANGUAGES];
  return (
    <View style={styles.languageRow}>
      {options.map((option) => (
        <Pressable
          accessibilityLabel={`Language ${languageLabel(option)}`}
          accessibilityRole="button"
          accessibilityState={{ selected: option === language }}
          key={option}
          onPress={() => onChangeLanguage(option)}
          style={[
            styles.chip,
            option === language ? styles.chipSelected : null,
          ]}
          testID={`categories-language-${option}`}
        >
          <Text selectable style={styles.chipLabel}>
            {languageLabel(option)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function categoryFixture(
  platform: Platform,
  mode: DiscoveryFixtureMode,
) {
  const streams = fixtureOutcome(platform, mode);
  return {
    ...streams,
    items: streams.items.map((stream) => ({
      boxArtUrl: "",
      id: `${platform}-cat`,
      name: platform === "twitch" ? "Just Chatting" : "Just Chatting",
      platform,
      viewerCount: stream.viewerCount,
    })),
  };
}

function phaseCopy(phase: ReturnType<typeof composeCategoryCatalog>["phase"]): string {
  switch (phase) {
    case "loading":
      return "Loading categories from Twitch and Kick.";
    case "ready":
      return "Browse categories across Twitch and Kick.";
    case "offline-cache":
      return "Showing cached categories while a live read is unavailable.";
    case "empty":
      return "No categories match this search.";
    case "failed":
      return "Categories could not be loaded.";
  }
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  summary: {
    color: mobileColors.textCategory,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
  languageRow: {
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.medium,
  },
});
