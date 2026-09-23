import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileSelect } from "@mobile/design/select";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoveryFixtureMode,
  DiscoverySession,
} from "../capabilities/platform-reads";
import { composeCategoryCatalog } from "../domain/category-catalog";
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
  embedded = false,
  onOpenAccounts,
  onOpenCategory,
  preferences,
  session,
}: {
  readonly embedded?: boolean;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory: (category: CategoryIdentity) => void;
  readonly preferences: DiscoveryPreferenceStore;
  readonly session: DiscoverySession;
}) {
  const [query, setQuery] = useState("");
  const live = useCategoryCatalog({
    preferences,
    query,
    session,
  });
  return (
    <CategoriesView
      embedded={embedded}
      onChangeLanguage={live.setLanguage}
      onChangeQuery={setQuery}
      onOpenAccounts={onOpenAccounts}
      onOpenCategory={onOpenCategory}
      onRetry={live.retry}
      view={live.view}
    />
  );
}

export function CategoriesView({
  embedded = false,
  onChangeLanguage,
  onChangeQuery,
  onOpenAccounts,
  onOpenCategory,
  onRefresh,
  onRetry,
  onSelectProofMode,
  proofMode,
  refreshing = false,
  view,
}: {
  readonly embedded?: boolean;
  readonly onChangeLanguage: (language: LanguageFilter) => void;
  readonly onChangeQuery: (query: string) => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory: (category: CategoryIdentity) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onRetry: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly refreshing?: boolean;
  readonly view: ReturnType<typeof composeCategoryCatalog>;
}) {
  return (
    <MobileRefreshableScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      onRefresh={onRefresh}
      refreshing={refreshing}
      style={styles.scroll}
      testID="categories-screen"
    >
      <Text selectable style={mobileType.body} testID="categories-phase">
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
    </MobileRefreshableScroll>
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
    <MobileSelect
      accessibilityLabel="Language"
      onChange={onChangeLanguage}
      options={options.map((option) => ({
        label: languageLabel(option),
        value: option,
      }))}
      testID="categories-language"
      value={language}
    />
  );
}

function phaseCopy(phase: ReturnType<typeof composeCategoryCatalog>["phase"]): string {
  switch (phase) {
    case "loading":
      return "Loading categories…";
    case "ready":
      return "Browse Twitch and Kick categories.";
    case "offline-cache":
      return "Cached categories — connection limited.";
    case "empty":
      return "No matching categories.";
    case "failed":
      return "Couldn't load categories.";
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.medium,
  },
});
