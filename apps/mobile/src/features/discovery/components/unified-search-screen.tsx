import { useState } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import type { SearchResultType } from "@streamfusion/core/discovery";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import { mobileColors, mobileSpacing } from "@mobile/design/tokens";
import type {
  DiscoveryFixtureMode,
  SearchHistoryRepository,
  SearchSession,
  UnifiedSearchView as UnifiedSearchModel,
} from "../capabilities/platform-reads";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import { historyScopeForTab } from "../domain/search-history";
import { watchTargetFromClip, watchTargetFromVideo } from "../domain/channel-watch-target";

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

export function UnifiedSearchScreen({
  history,
  onOpenAccounts,
  onOpenChannel,
  onWatch,
  session,
}: {
  readonly history: SearchHistoryRepository;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly session: SearchSession;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchResultType>("all");
  const [platform, setPlatform] = useState<SearchPlatformFilter>("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const live = useUnifiedSearch({
    history,
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
    if (next.length > 0) live.record(next);
  };

  return (
    <UnifiedSearchView
      draft={draft}
      liveOnly={liveOnly}
      onChangeDraft={setDraft}
      onClearDraft={() => {
        setDraft("");
        setQuery("");
      }}
      onOpenAccounts={onOpenAccounts}
      onRemoveHistory={live.remove}
      onRepeatHistory={submit}
      onRequestClear={live.requestClear}
      onCancelClear={live.cancelClear}
      onConfirmClear={() => {
        void live.confirmClear();
      }}
      onRetry={live.retry}
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
  draft,
  liveOnly,
  onCancelClear,
  onChangeDraft,
  onClearDraft,
  onConfirmClear,
  onOpenAccounts,
  onRemoveHistory,
  onRepeatHistory,
  onRequestClear,
  onRetry,
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
  readonly draft: string;
  readonly liveOnly: boolean;
  readonly onCancelClear: () => void;
  readonly onChangeDraft: (value: string) => void;
  readonly onClearDraft: () => void;
  readonly onConfirmClear: () => void;
  readonly onOpenAccounts: () => void;
  readonly onRemoveHistory: (query: string) => void;
  readonly onRepeatHistory: (query: string) => void;
  readonly onRequestClear: () => void;
  readonly onRetry: (platform: "kick" | "twitch") => void;
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
  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={styles.frame}
      testID="unified-search"
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <Text accessibilityRole="header" selectable style={styles.title}>
          Search Twitch + Kick
        </Text>
        <Text selectable style={styles.summary} testID="search-phase">
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
        <SearchHistoryPanel
          confirmClear={view.historyConfirmClear}
          history={view.history}
          onCancelClear={onCancelClear}
          onClear={onRequestClear}
          onConfirmClear={onConfirmClear}
          onRemove={onRemoveHistory}
          onRepeat={onRepeatHistory}
          scope={historyScopeForTab(tab)}
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
        {view.phase === "idle" ? null : (
          <>
            <Text selectable style={styles.heading}>
              {resultsHeading(tab)}
            </Text>
            {view.phase === "empty" ? (
              <Text selectable style={styles.summary}>
                No matching channels, streams, videos, clips, or categories.
              </Text>
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
                    onWatchVideo: (video) =>
                      onWatch(watchTargetFromVideo(video)),
                  })}
            />
          </>
        )}
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
  heading: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
});
