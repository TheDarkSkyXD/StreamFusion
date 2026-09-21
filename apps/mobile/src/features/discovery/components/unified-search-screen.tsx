import { useState, type ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SearchResultType } from "@streamfusion/core/discovery";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import { MobileFilterChip } from "@mobile/design/chip";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  DiscoveryFixtureMode,
  SearchHistoryRepository,
  SearchHistoryScope,
  SearchSession,
  UnifiedSearchView as UnifiedSearchModel,
} from "../capabilities/platform-reads";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import { historyScopeForTab } from "../domain/search-history";
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

export type SearchScreenMode = "search" | "categories" | "history";

const SEARCH_MODES = [
  { id: "search", label: "Search" },
  { id: "categories", label: "Categories" },
  { id: "history", label: "History" },
] as const satisfies readonly {
  readonly id: SearchScreenMode;
  readonly label: string;
}[];

const HISTORY_SCOPES = [
  { id: "channels", label: "Channels" },
  { id: "streams", label: "Streams" },
  { id: "categories", label: "Categories" },
] as const satisfies readonly {
  readonly id: SearchHistoryScope;
  readonly label: string;
}[];

export function UnifiedSearchScreen({
  categoriesPanel,
  history,
  onOpenAccounts,
  onOpenChannel,
  onWatch,
  session,
}: {
  readonly categoriesPanel?: ReactNode;
  readonly history: SearchHistoryRepository;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly session: SearchSession;
}) {
  const [mode, setMode] = useState<SearchScreenMode>("search");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchResultType>("all");
  const [platform, setPlatform] = useState<SearchPlatformFilter>("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const [historyScope, setHistoryScope] =
    useState<SearchHistoryScope>("channels");
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
      onRepeatHistory={submit}
      onRequestClear={live.requestClear}
      onRetry={live.retry}
      onSelectHistoryScope={setHistoryScope}
      onSelectMode={setMode}
      onSelectPlatform={setPlatform}
      onSelectTab={setTab}
      onSubmit={(value) => submit(value ?? draft)}
      onToggleLiveOnly={() => setLiveOnly((current) => !current)}
      {...(onOpenChannel === undefined ? {} : { onOpenChannel })}
      {...(onWatch === undefined ? {} : { onWatch })}
      platform={platform}
      tab={tab}
      view={live.view}
    />
  );
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
  onRemoveHistory,
  onRepeatHistory,
  onRequestClear,
  onRetry,
  onSelectHistoryScope,
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
  readonly onRemoveHistory: (query: string) => void;
  readonly onRepeatHistory: (query: string) => void;
  readonly onRequestClear: () => void;
  readonly onRetry: (platform: "kick" | "twitch") => void;
  readonly onSelectHistoryScope?: (scope: SearchHistoryScope) => void;
  readonly onSelectMode?: (mode: SearchScreenMode) => void;
  readonly onSelectPlatform: (platform: SearchPlatformFilter) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly onSelectTab: (tab: SearchResultType) => void;
  readonly onSubmit: (value?: string) => void;
  readonly onToggleLiveOnly: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly platform: SearchPlatformFilter;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly tab: SearchResultType;
  readonly view: UnifiedSearchModel;
}) {
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
              No matching channels, streams, videos, clips, or categories.
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
                  }),
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
      <View
        accessibilityLabel="Search modes"
        accessibilityRole="tablist"
        style={styles.modeTabs}
        testID="search-mode-tabs"
      >
        {SEARCH_MODES.map((entry) => (
          <MobileFilterChip
            accessibilityLabel={`${entry.label} search mode`}
            accessibilityRole="tab"
            key={entry.id}
            label={entry.label}
            onPress={() => onSelectMode(entry.id)}
            selected={mode === entry.id}
            testID={`search-mode-${entry.id}`}
          />
        ))}
      </View>
    );

  if (mode === "categories") {
    return (
      <KeyboardAvoidingView style={styles.frame} testID="unified-search">
        <View style={styles.modeChrome}>
          <MobileScreenHeader title="Search Twitch + Kick" />
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

  if (mode === "history") {
    return (
      <KeyboardAvoidingView style={styles.frame} testID="unified-search">
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
        >
          <MobileScreenHeader title="Search Twitch + Kick" />
          {modeTabs}
          <Text
            selectable
            style={mobileType.body}
            testID="search-history-mode-copy"
          >
            Recent searches stay on this device. Repeat opens Search.
          </Text>
          {onSelectHistoryScope ? (
            <View accessibilityLabel="History types" style={styles.scopeTabs}>
              {HISTORY_SCOPES.map((entry) => (
                <MobileFilterChip
                  accessibilityLabel={`${entry.label} search history`}
                  accessibilityRole="tab"
                  key={entry.id}
                  label={entry.label}
                  onPress={() => onSelectHistoryScope(entry.id)}
                  selected={activeHistoryScope === entry.id}
                  testID={`search-history-scope-${entry.id}`}
                />
              ))}
            </View>
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
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.frame} testID="unified-search">
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <MobileScreenHeader title="Search Twitch + Kick" />
        {modeTabs}
        <Text selectable style={mobileType.body} testID="search-phase">
          {phaseCopy(view)}
        </Text>
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
        {resultsBlock}
      </ScrollView>
      <SearchDock
        onChangeText={onChangeDraft}
        onClear={onClearDraft}
        onSubmit={onSubmit}
        value={draft}
      />
    </KeyboardAvoidingView>
  );
}

function phaseCopy(view: UnifiedSearchModel): string {
  switch (view.phase) {
    case "idle":
      return "Search works without signing in.";
    case "loading":
      return "Loading search results from Twitch and Kick.";
    case "ready":
      return "Search results from Twitch and Kick.";
    case "partial":
      return "Some platforms returned results. Failed providers stay visible.";
    case "offline-cache":
      return "Showing cached search results while a live read is unavailable.";
    case "empty":
      return "No matching channels, streams, videos, clips, or categories.";
    case "failed":
      return "Search results could not be loaded.";
  }
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
  modeTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
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
