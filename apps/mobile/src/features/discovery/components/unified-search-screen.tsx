import { useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import type { SearchResultType } from "@streamfusion/core/discovery";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
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
    Keyboard.dismiss();
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
});
