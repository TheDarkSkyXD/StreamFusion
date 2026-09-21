import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import type {
  FollowedClipPeriod,
  FollowedRecordedSort,
} from "@streamfusion/core/relay";

import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { mobileSpacing } from "@mobile/design/tokens";

import type {
  FollowingChip,
  FollowingSession,
  FollowingTab,
} from "../capabilities/following-session";
import { FollowingControls } from "./following-controls";
import { FollowingTabBody } from "./following-tab-body";
import { useFollowingView } from "./use-following-view";

export function FollowingScreen({
  onOpenManage,
  session,
}: {
  readonly onOpenManage: () => void;
  readonly session: FollowingSession;
}) {
  const [tab, setTab] = useState<FollowingTab>("live");
  const [chip, setChip] = useState<FollowingChip>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FollowedRecordedSort>("recent");
  const [period, setPeriod] = useState<FollowedClipPeriod>("all");
  const live = useFollowingView({
    chip,
    period,
    query,
    session,
    sort,
    tab,
  });
  return (
    <FollowingScreenBody
      chip={chip}
      onChip={setChip}
      onOpenManage={onOpenManage}
      onOpenProvider={(target) => {
        void session.openProviderPage(target);
      }}
      onPeriod={setPeriod}
      onQuery={setQuery}
      onRetry={() => live.refresh()}
      onSort={setSort}
      onTab={setTab}
      period={period}
      query={query}
      sort={sort}
      tab={tab}
      view={live.view}
    />
  );
}

function FollowingScreenBody({
  chip,
  onChip,
  onOpenManage,
  onOpenProvider,
  onPeriod,
  onQuery,
  onRetry,
  onSort,
  onTab,
  period,
  query,
  sort,
  tab,
  view,
}: {
  readonly chip: FollowingChip;
  readonly onChip: (chip: FollowingChip) => void;
  readonly onOpenManage: () => void;
  readonly onOpenProvider: (target: {
    readonly platform: Platform;
    readonly channelLogin: string;
  }) => void;
  readonly onPeriod: (period: FollowedClipPeriod) => void;
  readonly onQuery: (query: string) => void;
  readonly onRetry: () => void;
  readonly onSort: (sort: FollowedRecordedSort) => void;
  readonly onTab: (tab: FollowingTab) => void;
  readonly period: FollowedClipPeriod;
  readonly query: string;
  readonly sort: FollowedRecordedSort;
  readonly tab: FollowingTab;
  readonly view: ReturnType<typeof useFollowingView>["view"];
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="following-screen"
    >
      <MobileScreenHeader title="Following" />
      <MobileButton
        accessibilityLabel="Manage Guest Follows"
        onPress={onOpenManage}
        testID="following-open-manage"
        variant="secondary"
      >
        Manage Guest Follows
      </MobileButton>
      <FollowingControls
        chip={chip}
        onChip={onChip}
        onQuery={onQuery}
        onTab={onTab}
        query={query}
        tab={tab}
      />
      {tab === "videos" || tab === "clips" ? (
        <RecordedControls
          onPeriod={onPeriod}
          onSort={onSort}
          period={period}
          sort={sort}
          tab={tab}
        />
      ) : null}
      <FollowingTabBody
        onOpenProvider={onOpenProvider}
        onRetry={onRetry}
        view={view}
      />
    </ScrollView>
  );
}

function RecordedControls({
  onPeriod,
  onSort,
  period,
  sort,
  tab,
}: {
  readonly onPeriod: (period: FollowedClipPeriod) => void;
  readonly onSort: (sort: FollowedRecordedSort) => void;
  readonly period: FollowedClipPeriod;
  readonly sort: FollowedRecordedSort;
  readonly tab: FollowingTab;
}) {
  return (
    <View style={styles.row}>
      {(["recent", "views"] as const).map((value) => (
        <MobileFilterChip
          accessibilityLabel={`Sort by ${value}`}
          key={value}
          label={value}
          onPress={() => onSort(value)}
          selected={sort === value}
          testID={`following-sort-${value}`}
        />
      ))}
      {tab === "clips"
        ? (["day", "week", "month", "all"] as const).map((value) => (
            <MobileFilterChip
              accessibilityLabel={`Clips period ${value}`}
              key={value}
              label={value}
              onPress={() => onPeriod(value)}
              selected={period === value}
              testID={`following-period-${value}`}
            />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
});
