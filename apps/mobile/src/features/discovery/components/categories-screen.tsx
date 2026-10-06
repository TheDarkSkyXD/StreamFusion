import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileSkeleton } from "@mobile/design/feedback";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileSelect } from "@mobile/design/select";
import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";
import { FollowingCategoryCard } from "@mobile/features/follows/components/following-category-card";
import { tabItemsCopy } from "@mobile/features/follows/components/following-tab-copy";
import { useFollowingView } from "@mobile/features/follows/components/use-following-view";
import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoveryFixtureMode,
  DiscoverySession,
} from "../capabilities/platform-reads";
import { composeCategoryCatalog } from "../domain/category-catalog";
import type {
  CatalogCategory,
  CategoryIdentity,
} from "../domain/category-identity";
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
  followingSession,
  onOpenAccounts,
  onOpenCategory,
  preferences,
  session,
}: {
  readonly embedded?: boolean;
  readonly followingSession?: FollowingSession;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory: (category: CategoryIdentity) => void;
  readonly preferences: DiscoveryPreferenceStore;
  readonly session: DiscoverySession;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"popular" | "followed">("popular");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const live = useCategoryCatalog({
    preferences,
    query,
    session,
  });
  return (
    <CategoriesView
      embedded={embedded}
      {...(followingSession === undefined ? {} : { followingSession })}
      onChangeLanguage={live.setLanguage}
      onChangeQuery={setQuery}
      onChangePlatform={setPlatform}
      onChangeTab={setTab}
      onOpenAccounts={onOpenAccounts}
      onOpenCategory={onOpenCategory}
      onRetry={live.retry}
      platform={platform}
      tab={tab}
      view={live.view}
    />
  );
}

export function CategoriesView({
  embedded = false,
  followingSession,
  onChangeLanguage,
  onChangePlatform,
  onChangeQuery,
  onChangeTab,
  onOpenAccounts,
  onOpenCategory,
  onRefresh,
  onRetry,
  onSelectProofMode,
  proofMode,
  platform = "all",
  refreshing = false,
  tab = "popular",
  view,
}: {
  readonly embedded?: boolean;
  readonly followingSession?: FollowingSession;
  readonly onChangeLanguage: (language: LanguageFilter) => void;
  readonly onChangePlatform?: (platform: "all" | Platform) => void;
  readonly onChangeQuery: (query: string) => void;
  readonly onChangeTab?: (tab: "popular" | "followed") => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory: (category: CategoryIdentity) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onRetry: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly platform?: "all" | Platform;
  readonly refreshing?: boolean;
  readonly tab?: "popular" | "followed";
  readonly view: ReturnType<typeof composeCategoryCatalog>;
}) {
  const { t } = useTranslation();
  const translate = (key: string, values?: Record<string, unknown>) =>
    values === undefined ? t(key) : t(key, values);
  const categories = visibleCategories(view, platform);
  return (
    <MobileRefreshableScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      onRefresh={onRefresh}
      refreshing={refreshing}
      style={styles.scroll}
      testID="categories-screen"
    >
      <DiscoverySearchDock
        onChangeQuery={onChangeQuery}
        placeholder={t("discovery.filterCategoriesPlaceholder")}
        query={view.query}
        testID="categories-search"
      />
      {followingSession ? (
        <MobileUnderlineTabs
          accessibilityLabel="Category collection"
          onSelect={(next) => onChangeTab?.(next)}
          selectedId={tab}
          tabs={[
            {
              id: "popular",
              label: "Popular",
              testID: "categories-tab-popular",
            },
            {
              id: "followed",
              label: "Followed",
              testID: "categories-tab-followed",
            },
          ]}
          testID="categories-tabs"
        />
      ) : null}
      <View style={styles.filters}>
        {(["all", "twitch", "kick"] as const).map((value) => (
          <MobileFilterChip
            accessibilityLabel={
              value === "all" ? t("discovery.following.all") : value
            }
            key={value}
            label={
              value === "all"
                ? t("discovery.following.all")
                : value === "twitch"
                  ? "Twitch"
                  : "Kick"
            }
            onPress={() => onChangePlatform?.(value)}
            selected={value === platform}
            testID={`categories-platform-${value}`}
          />
        ))}
      </View>
      {tab === "popular" ? (
        <>
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
          {view.phase !== "loading" ? (
            <>
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
              <Text
                selectable
                style={mobileType.body}
                testID="categories-phase"
              >
                {phaseCopy(
                  view.phase,
                  view.query,
                  categories.length,
                  translate,
                )}
              </Text>
            </>
          ) : null}
          <View style={styles.grid}>
            {categories.map((category) => (
              <CategoryCard
                category={category}
                key={`${category.platform}:${category.id}`}
                onPress={() => onOpenCategory(identityFromCategory(category))}
              />
            ))}
          </View>
          {view.phase === "loading" && categories.length === 0 ? (
            <LoadingCards />
          ) : null}
        </>
      ) : followingSession ? (
        <FollowedCategories
          catalog={view.categories}
          onOpenCategory={onOpenCategory}
          platform={platform}
          query={view.query}
          session={followingSession}
        />
      ) : null}
    </MobileRefreshableScroll>
  );
}

function visibleCategories(
  view: ReturnType<typeof composeCategoryCatalog>,
  platform: "all" | Platform,
): readonly CatalogCategory[] {
  if (platform === "all") return view.categories;
  return view.categories.flatMap((category) => {
    const id = category.platform === platform ? category.id : category.otherId;
    if (id === undefined) return [];
    const providerCategory = view.providers[platform].items.find(
      (item) => item.id === id,
    );
    const base = providerCategory ?? {
      boxArtUrl: category.boxArtUrl,
      id,
      name: category.name,
      platform,
    };
    const otherId =
      category.platform === platform ? category.otherId : category.id;
    return [{ ...base, ...(otherId === undefined ? {} : { otherId }) }];
  });
}

function FollowedCategories({
  catalog,
  onOpenCategory,
  platform,
  query,
  session,
}: {
  readonly catalog: readonly CatalogCategory[];
  readonly onOpenCategory: (category: CategoryIdentity) => void;
  readonly platform: "all" | Platform;
  readonly query: string;
  readonly session: FollowingSession;
}) {
  const { t } = useTranslation();
  const translate = (key: string, values?: Record<string, unknown>) =>
    values === undefined ? t(key) : t(key, values);
  const follow = useFollowingView({
    chip: platform,
    period: "all",
    query,
    session,
    sort: "recent",
    tab: "categories",
  });
  const items = follow.view.categories;
  if (items.kind === "loading") return <LoadingCards />;
  const categories = "items" in items ? items.items : [];
  return (
    <>
      {items.kind !== "ready" ? (
        <Text
          selectable
          style={mobileType.body}
          testID="categories-followed-phase"
        >
          {tabItemsCopy("categories", items, translate)}
        </Text>
      ) : null}
      {items.kind === "failed" || items.kind === "partial" ? (
        <MobileButton
          accessibilityLabel={t("discovery.tryAgain")}
          onPress={() => void follow.refresh()}
          testID="categories-followed-retry"
          variant="secondary"
        >
          {t("discovery.tryAgain")}
        </MobileButton>
      ) : null}
      <View style={styles.grid}>
        {categories.map((category) => {
          const art = catalog.find((candidate) =>
            candidate.platform === category.platform
              ? candidate.id === category.id
              : candidate.otherId === category.id,
          )?.boxArtUrl;
          const display = {
            ...category,
            boxArtUrl: category.boxArtUrl || art || "",
          };
          return (
            <FollowingCategoryCard
              category={display}
              key={`${category.platform}:${category.id}`}
              onPress={() => onOpenCategory(identityFromCategory(display))}
              viewersLabel={t("discovery.viewers", {
                count: category.viewerCount ?? 0,
                formattedCount: (category.viewerCount ?? 0).toLocaleString(),
              })}
            />
          );
        })}
      </View>
    </>
  );
}

function LoadingCards() {
  return (
    <View style={styles.loading} testID="categories-loading">
      <MobileSkeleton kind="card" />
      <MobileSkeleton kind="card" />
      <MobileSkeleton kind="card" />
    </View>
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

function phaseCopy(
  phase: ReturnType<typeof composeCategoryCatalog>["phase"],
  query: string,
  count: number,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  switch (phase) {
    case "loading":
      return t("discovery.browseByCategory");
    case "ready":
      return t("discovery.categoryCount", { count });
    case "offline-cache":
      return t("discovery.browseByCategory");
    case "empty":
      return query.trim()
        ? t("discovery.noMatchingCategories", { query })
        : t("discovery.noCategories");
    case "failed":
      return t("discovery.loadCategoriesError");
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
    columnGap: "4%",
    rowGap: mobileSpacing.medium,
  },
  filters: { flexDirection: "row", gap: mobileSpacing.small },
  loading: { gap: mobileSpacing.medium },
});
