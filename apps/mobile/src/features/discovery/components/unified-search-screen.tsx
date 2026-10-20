import { useEffect, useState, type ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SearchResultType } from "@streamfusion/core/discovery";
import type { Category } from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  DiscoveryFixtureMode,
  MobileSearchKind,
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
  watchTargetFromStream,
  watchTargetFromVideo,
} from "../domain/channel-watch-target";

import { SearchDock } from "./search-dock";
import { SearchFilters, type SearchPlatformFilter } from "./search-filters";
import { SearchHistoryPanel } from "./search-history-panel";
import { SearchProofControls } from "./search-proof-controls";
import { SearchProviderBanner } from "./search-provider-banner";
import { SearchResultsView } from "./search-results-view";
import { useUnifiedSearch } from "./use-unified-search";

export type SearchScreenMode = "browse" | "search";
export type SearchPresentationState = {
  readonly draft: string;
  readonly query: string;
  readonly tab: SearchResultType;
  readonly platform: SearchPlatformFilter;
  readonly liveOnly: boolean;
};

export function UnifiedSearchScreen({
  categoriesPanel,
  focused,
  history,
  initialQuery,
  onOpenAccounts,
  onOpenCategory,
  onOpenChannel,
  onSearchFocusChange,
  onStateChange,
  onWatch,
  restoredState,
  session,
}: {
  readonly categoriesPanel?: ReactNode;
  readonly focused?: boolean;
  readonly history: SearchHistoryRepository;
  readonly initialQuery?: string;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory?: (category: Category) => void;
  readonly onOpenChannel?: (
    channel: ChannelIdentity & { readonly avatarUrl?: string | null },
  ) => void;
  readonly onSearchFocusChange?: (focused: boolean) => void;
  readonly onStateChange?: (state: SearchPresentationState) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly restoredState?: SearchPresentationState;
  readonly session: SearchSession;
}) {
  const seededQuery = initialQuery?.trim() ?? "";
  const [localMode, setLocalMode] = useState<SearchScreenMode>(
    seededQuery ? "search" : "browse",
  );
  const mode =
    focused === undefined ? localMode : focused ? "search" : "browse";
  const [draft, setDraft] = useState(seededQuery || restoredState?.draft || "");
  const [query, setQuery] = useState(seededQuery || restoredState?.query || "");
  const [tab, setTab] = useState<SearchResultType>(restoredState?.tab ?? "all");
  const [platform, setPlatform] = useState<SearchPlatformFilter>(
    restoredState?.platform ?? "all",
  );
  const [liveOnly, setLiveOnly] = useState(restoredState?.liveOnly ?? false);
  useEffect(() => {
    onStateChange?.({ draft, query, tab, platform, liveOnly });
  }, [draft, query, tab, platform, liveOnly, onStateChange]);
  const historyScope = historyScopeForTab(tab);
  const live = useUnifiedSearch({
    enabled: mode === "search",
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
    Keyboard.dismiss();
    if (next.length > 0) live.record(next);
  };

  const changeMode = (next: SearchScreenMode) => {
    setLocalMode(next);
    onSearchFocusChange?.(next === "search");
    if (next === "browse") {
      live.cancelClear();
      Keyboard.dismiss();
    }
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
      {...(onOpenCategory === undefined ? {} : { onOpenCategory })}
      onRemoveHistory={live.remove}
      onRepeatHistory={(entry) => submit(historyEntryLabel(entry))}
      onRequestClear={live.requestClear}
      onRefresh={() => live.refresh()}
      onRetry={live.retry}
      onLoadMore={live.loadMore}
      refreshing={live.refreshing}
      onBack={() => changeMode("browse")}
      onSelectPlatform={setPlatform}
      onSelectTab={(next) => {
        live.cancelClear();
        setTab(next);
      }}
      onSubmit={(value) => submit(value ?? draft)}
      onToggleLiveOnly={() => setLiveOnly((current) => !current)}
      {...(onOpenChannel === undefined
        ? {}
        : {
            onOpenChannel: (channel) => {
              const avatarUrl = channelAvatar(channel);
              live.record({
                label: channel.username,
                channelId: channel.id,
                platform: channel.platform,
                username: channel.username,
                ...(avatarUrl === undefined ? {} : { avatarUrl }),
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

function channelAvatar(
  channel: ChannelIdentity & { readonly avatarUrl?: string | null },
): string | undefined {
  const url = channel.avatarUrl?.trim();
  return url && url.length > 0 ? url : undefined;
}

export function UnifiedSearchView({
  categoriesPanel,
  draft,
  historyScope,
  liveOnly,
  mode = "search",
  onBack,
  onCancelClear,
  onChangeDraft,
  onClearDraft,
  onConfirmClear,
  onOpenAccounts,
  onOpenCategory,
  onRefresh,
  onRemoveHistory,
  onRepeatHistory,
  onRequestClear,
  onRetry,
  onLoadMore,
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
  readonly onBack?: () => void;
  readonly onCancelClear: () => void;
  readonly onChangeDraft: (value: string) => void;
  readonly onClearDraft: () => void;
  readonly onConfirmClear: () => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategory?: (category: Category) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onRemoveHistory: (entry: SearchHistoryEntry) => void;
  readonly onRepeatHistory: (entry: SearchHistoryEntry) => void;
  readonly onRequestClear: () => void;
  readonly onRetry: (platform: "kick" | "twitch") => void;
  readonly onLoadMore?: (kind: MobileSearchKind) => void;
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
  const activeHistoryScope = historyScope ?? historyScopeForTab(tab);
  const resultHeader = (
    <View style={styles.content}>
      {proofMode && onSelectProofMode ? (
        <SearchProofControls mode={proofMode} onSelect={onSelectProofMode} />
      ) : null}
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
      {view.phase === "empty" ? (
        <MobileStatusPanel tone="empty">
          <Text selectable style={mobileType.body}>
            No results.
          </Text>
        </MobileStatusPanel>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.frame} testID="unified-search">
      <View
        style={[styles.panel, mode === "browse" ? null : styles.hidden]}
        testID="search-categories-panel"
      >
        {categoriesPanel ?? (
          <MobileStatusPanel tone="empty">
            <Text selectable style={mobileType.body}>
              Categories are unavailable.
            </Text>
          </MobileStatusPanel>
        )}
      </View>
      {mode === "search" ? (
        <View style={styles.panel}>
          <SearchDock
            autoFocus
            {...(onBack === undefined ? {} : { onBack })}
            onChangeText={onChangeDraft}
            onClear={onClearDraft}
            onSubmit={onSubmit}
            value={draft}
          />
          <SearchFilters
            liveOnly={liveOnly}
            onSelectPlatform={onSelectPlatform}
            onSelectTab={onSelectTab}
            onToggleLiveOnly={onToggleLiveOnly}
            platform={platform}
            tab={tab}
          />
          {view.phase === "idle" ? (
            <MobileRefreshableScroll
              contentContainerStyle={styles.content}
              contentInsetAdjustmentBehavior="automatic"
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              onRefresh={onRefresh}
              refreshing={refreshing}
              style={styles.scroll}
            >
              {proofMode && onSelectProofMode ? (
                <SearchProofControls
                  mode={proofMode}
                  onSelect={onSelectProofMode}
                />
              ) : null}
              <SearchHistoryPanel
                confirmClear={view.historyConfirmClear}
                history={view.history}
                onCancelClear={onCancelClear}
                onClear={onRequestClear}
                onConfirmClear={onConfirmClear}
                onRemove={onRemoveHistory}
                onRepeat={onRepeatHistory}
                scope={activeHistoryScope}
              />
            </MobileRefreshableScroll>
          ) : (
            <SearchResultsView
              header={resultHeader}
              {...(onOpenCategory === undefined ? {} : { onOpenCategory })}
              {...(onLoadMore === undefined ? {} : { onLoadMore })}
              {...(onRefresh === undefined ? {} : { onRefresh })}
              refreshing={refreshing}
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
                    onWatchStream: (stream) =>
                      onWatch(watchTargetFromStream(stream)),
                    onWatchVideo: (video) =>
                      onWatch(watchTargetFromVideo(video)),
                  })}
            />
          )}
        </View>
      ) : null}
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
  panel: {
    flex: 1,
    minHeight: 0,
  },
  hidden: { display: "none" },
});
