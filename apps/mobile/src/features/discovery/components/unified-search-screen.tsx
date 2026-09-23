import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SearchResultType } from "@streamfusion/core/discovery";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  DiscoveryFixtureMode,
  SearchHistoryEntry,
  SearchHistoryRepository,
  SearchHistoryScope,
  SearchSession,
  UnifiedSearchView as UnifiedSearchModel,
} from "../capabilities/platform-reads";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import {
  historyEntryLabel,
  historyScopeForTab,
} from "../domain/search-history";
import {
  watchTargetFromClip,
  watchTargetFromVideo,
} from "../domain/channel-watch-target";

import { SearchDock } from "./search-dock";
import {
  SearchFilters,
  type SearchPlatformFilter,
} from "./search-filters";
import { SearchHistoryPanel } from "./search-history-panel";
import { SearchProofControls } from "./search-proof-controls";
import { SearchProviderBanner } from "./search-provider-banner";
import { SearchResultsView, resultsHeading } from "./search-results-view";
import { useUnifiedSearch } from "./use-unified-search";

export type SearchScreenMode = "search" | "categories";

const SEARCH_MODES = [
  { id: "search", label: "Search" },
  { id: "categories", label: "Categories" },
] as const satisfies readonly {
  readonly id: SearchScreenMode;
  readonly label: string;
}[];

export function UnifiedSearchScreen({
  categoriesPanel,
  history,
  initialQuery,
  onOpenAccounts,
  onOpenChannel,
  onWatch,
  session,
}: {
  readonly categoriesPanel?: ReactNode;
  readonly history: SearchHistoryRepository;
  readonly initialQuery?: string;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (
    channel: ChannelIdentity & { readonly avatarUrl?: string | null },
  ) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly session: SearchSession;
}) {
  const seededQuery = initialQuery?.trim() ?? "";
  const [mode, setMode] = useState<SearchScreenMode>("search");
  const [draft, setDraft] = useState(seededQuery);
  const [query, setQuery] = useState(seededQuery);
  const [tab, setTab] = useState<SearchResultType>("all");
  const [platform, setPlatform] = useState<SearchPlatformFilter>("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const historyScope = historyScopeForTab(tab);
  const live = useUnifiedSearch({
    history,
    historyScope,
    liveOnly,
    platform,
    query,
    resultType: tab,
    session,
  });

  const submit = (value: string) => {
    const next = value.trim();
    setDraft(next);
    setQuery(next);
    setMode("search");
    Keyboard.dismiss();
    if (next.length > 0) live.record(next);
  };

  return (
    <UnifiedSearchView
      categoriesPanel={categoriesPanel}
      draft={draft}
      historyScope={historyScope}
      liveOnly={liveOnly}
      mode={mode}
      onCancelClear={live.cancelClear}
      onChangeDraft={setDraft}
      onClearDraft={() => {
        setDraft("");
        setQuery("");
      }}
      onConfirmClear={() => {
        void live.confirmClear();
      }}
      onOpenAccounts={onOpenAccounts}
      onRemoveHistory={live.remove}
      onRepeatHistory={(entry) => submit(historyEntryLabel(entry))}
      onRequestClear={live.requestClear}
      onRefresh={() => live.refresh()}
      onRetry={live.retry}
      refreshing={live.refreshing}
      onSelectMode={setMode}
      onSelectPlatform={setPlatform}
      onSelectTab={setTab}
      onSubmit={(value) => submit(value ?? draft)}
      onToggleLiveOnly={() => setLiveOnly((current) => !current)}
      {...(onOpenChannel === undefined
        ? {}
        : {
            onOpenChannel: (channel) => {
              live.record({
                label: channel.username,
                channelId: channel.id,
                platform: channel.platform,
                username: channel.username,
                ...(channelAvatar(channel) === undefined
                  ? {}
                  : { avatarUrl: channelAvatar(channel) }),
              });
              onOpenChannel(channel);
            },
          })}
      {...(onWatch === undefined ? {} : { onWatch })}
      platform={platform}
      tab={tab}
      view={live.view}
    />
  );
}

function channelAvatar(channel: ChannelIdentity & { readonly avatarUrl?: string | null }): string | undefined {
  const url = channel.avatarUrl?.trim();
  return url && url.length > 0 ? url : undefined;
}

export function UnifiedSearchView({
  categoriesPanel,
  draft,
  historyScope = "channels",
  liveOnly,
  mode = "search",
  onCancelClear,
  onChangeDraft,
  onClearDraft,
  onConfirmClear,
  onOpenAccounts,
  onRefresh,
  onRemoveHistory,
  onRepeatHistory,
  onRequestClear,
  onRetry,
  onSelectMode,
  onSelectPlatform,
  onSelectProofMode,
  onSelectTab,
  onSubmit,
  onToggleLiveOnly,
  onOpenChannel,
  onWatch,
  platform,
  proofMode,
  refreshing = false,
  tab,
  view,
}: {
  readonly categoriesPanel?: ReactNode;
  readonly draft: string;
  readonly historyScope?: SearchHistoryScope;
  readonly liveOnly: boolean;
  readonly mode?: SearchScreenMode;
  readonly onCancelClear: () => void;
  readonly onChangeDraft: (value: string) => void;
  readonly onClearDraft: () => void;
  readonly onConfirmClear: () => void;
  readonly onOpenAccounts: () => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onRemoveHistory: (entry: SearchHistoryEntry) => void;
  readonly onRepeatHistory: (entry: SearchHistoryEntry) => void;
  readonly onRequestClear: () => void;
  readonly onRetry: (platform: "kick" | "twitch") => void;
  readonly onSelectMode?: (mode: SearchScreenMode) => void;
  readonly onSelectPlatform: (platform: SearchPlatformFilter) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly onSelectTab: (tab: SearchResultType) => void;
  readonly onSubmit: (value?: string) => void;
  readonly onToggleLiveOnly: () => void;
  readonly onOpenChannel?: (
    channel: ChannelIdentity & { readonly avatarUrl?: string | null },
  ) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly platform: SearchPlatformFilter;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly refreshing?: boolean;
  readonly tab: SearchResultType;
  readonly view: UnifiedSearchModel;
}) {
  const { t } = useTranslation();
  const activeHistoryScope = historyScope ?? historyScopeForTab(tab);
  const resultsBlock =
    view.phase === "idle" ? null : (
      <>
        <Text selectable style={styles.heading} testID="search-results-heading">
          {resultsHeading(tab)}
        </Text>
        {view.phase === "empty" ? (
          <MobileStatusPanel tone="empty">
            <Text selectable style={mobileType.body}>
              No results.
            </Text>
          </MobileStatusPanel>
        ) : null}
        <SearchResultsView
          view={view}
          {...(onOpenChannel === undefined
            ? {}
            : {
                onOpenChannel: (channel) =>
                  onOpenChannel({
                    id: channel.id,
                    platform: channel.platform,
                    username: channel.username,
                    ...(channel.avatarUrl
                      ? { avatarUrl: channel.avatarUrl }
                      : {}),
                  } as ChannelIdentity & { avatarUrl?: string }),
              })}
          {...(onWatch === undefined
            ? {}
            : {
                onWatchClip: (clip) => onWatch(watchTargetFromClip(clip)),
                onWatchVideo: (video) => onWatch(watchTargetFromVideo(video)),
              })}
        />
      </>
    );

  const modeTabs =
    onSelectMode === undefined ? null : (
      <MobileUnderlineTabs
        accessibilityLabel="Search modes"
        onSelect={onSelectMode}
        selectedId={mode}
        tabs={SEARCH_MODES.map((entry) => ({
          accessibilityLabel: `${entry.label} search mode`,
          id: entry.id,
          label: entry.label,
          testID: `search-mode-${entry.id}`,
        }))}
        testID="search-mode-tabs"
      />
    );

  if (mode === "categories") {
    return (
      <KeyboardAvoidingView style={styles.frame} testID="unified-search">
        <View style={styles.modeChrome}>
          <MobileScreenHeader title={t("discovery.search.title")} />
          {modeTabs}
        </View>
        <View style={styles.panel} testID="search-categories-panel">
          {categoriesPanel ?? (
            <MobileStatusPanel tone="empty">
              <Text selectable style={mobileType.body}>
                Categories are unavailable in this Search session.
              </Text>
            </MobileStatusPanel>
          )}
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.frame} testID="unified-search">
      <MobileRefreshableScroll
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onRefresh={onRefresh}
        refreshing={refreshing}
        style={styles.scroll}
      >
        <MobileScreenHeader title={t("discovery.search.title")} />
        {modeTabs}
        {proofMode && onSelectProofMode ? (
          <SearchProofControls mode={proofMode} onSelect={onSelectProofMode} />
        ) : null}
        <SearchFilters
          liveOnly={liveOnly}
          onSelectPlatform={onSelectPlatform}
          onSelectTab={onSelectTab}
          onToggleLiveOnly={onToggleLiveOnly}
          platform={platform}
          tab={tab}
        />
        {view.intent ? (
          <>
            <SearchProviderBanner
              onOpenAccounts={onOpenAccounts}
              onRetry={onRetry}
              outcome={view.providers.twitch}
            />
            <SearchProviderBanner
              onOpenAccounts={onOpenAccounts}
              onRetry={onRetry}
              outcome={view.providers.kick}
            />
          </>
        ) : null}
        {view.phase === "idle" ? (
          <SearchHistoryPanel
            confirmClear={view.historyConfirmClear}
            fallbackPlatform={platform === "all" ? "twitch" : platform}
            history={view.history}
            onCancelClear={onCancelClear}
            onClear={onRequestClear}
            onConfirmClear={onConfirmClear}
            onRemove={onRemoveHistory}
            onRepeat={onRepeatHistory}
            scope={activeHistoryScope}
            {...(onOpenChannel === undefined ? {} : { onOpenChannel })}
          />
        ) : (
          resultsBlock
        )}
      </MobileRefreshableScroll>
      <SearchDock
        onChangeText={onChangeDraft}
        onClear={onClearDraft}
        onSubmit={onSubmit}
        value={draft}
      />
    </KeyboardAvoidingView>
  );
}


const styles = StyleSheet.create({
  frame: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  heading: {
    ...mobileType.label,
    letterSpacing: 1,
  },
  modeChrome: {
    gap: mobileSpacing.medium,
    paddingHorizontal: mobileSpacing.medium,
    paddingTop: mobileSpacing.medium,
  },
  scopeTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  panel: {
    flex: 1,
    minHeight: 0,
  },
});
