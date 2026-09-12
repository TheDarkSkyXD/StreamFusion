import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type {
  FollowedClipPeriod,
  FollowedRecordedSort,
} from "@streamfusion/core/relay";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

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
      <Text accessibilityRole="header" selectable style={styles.title}>
        Following
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onOpenManage}
        style={styles.manage}
        testID="following-open-manage"
      >
        <Text selectable style={styles.manageLabel}>
          Manage Guest Follows
        </Text>
      </Pressable>
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
      <FollowingTabBody onRetry={onRetry} view={view} />
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
        <Pressable
          accessibilityRole="button"
          key={value}
          onPress={() => onSort(value)}
          style={[styles.chip, sort === value ? styles.selected : null]}
          testID={`following-sort-${value}`}
        >
          <Text selectable style={styles.chipLabel}>
            {value}
          </Text>
        </Pressable>
      ))}
      {tab === "clips"
        ? (["day", "week", "month", "all"] as const).map((value) => (
            <Pressable
              accessibilityRole="button"
              key={value}
              onPress={() => onPeriod(value)}
              style={[styles.chip, period === value ? styles.selected : null]}
              testID={`following-period-${value}`}
            >
              <Text selectable style={styles.chipLabel}>
                {value}
              </Text>
            </Pressable>
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
  title: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  manage: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  manageLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  chip: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  selected: { backgroundColor: mobileColors.navigationSelected },
  chipLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
