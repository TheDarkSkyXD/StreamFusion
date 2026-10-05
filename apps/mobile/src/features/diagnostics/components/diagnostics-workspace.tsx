import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { mobileColors, mobileRadii, mobileSpacing, mobileType } from "@mobile/design/tokens";
import {
  MOBILE_DIAGNOSTICS_TABS,
  type MobileDiagnosticsTab,
} from "../capabilities/diagnostics-workspace";
import {
  DIAGNOSTICS_REDACTION_COPY,
  DIAGNOSTICS_TAB_LABELS,
} from "../domain/diagnostics-workspace";

type DiagnosticsWorkspaceProps = {
  readonly collectionCopy: string;
  readonly observationCopy: string;
  readonly onRunCheck: () => void;
  readonly onSelectTab: (tab: MobileDiagnosticsTab) => void;
  readonly selectedTab: MobileDiagnosticsTab;
  readonly slots: Record<MobileDiagnosticsTab, ReactNode>;
};

export function DiagnosticsWorkspace({
  collectionCopy,
  observationCopy,
  onRunCheck,
  onSelectTab,
  selectedTab,
  slots,
}: DiagnosticsWorkspaceProps) {
  return (
    <View style={styles.screen} testID="screen-diagnostics">
      <View
        accessibilityLabel="Diagnostics sections"
        accessibilityRole="tablist"
        style={styles.tabs}
      >
        <ScrollView
          contentContainerStyle={styles.tabRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {MOBILE_DIAGNOSTICS_TABS.map((tab) => (
            <MobileFilterChip
              accessibilityLabel={DIAGNOSTICS_TAB_LABELS[tab]}
              accessibilityRole="tab"
              key={tab}
              label={DIAGNOSTICS_TAB_LABELS[tab]}
              onPress={() => onSelectTab(tab)}
              selected={tab === selectedTab}
              testID={`diagnostics-tab-${tab}`}
            />
          ))}
        </ScrollView>
      </View>
      <MobileRefreshableScroll
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        nestedScrollEnabled
        onRefresh={onRunCheck}
        style={styles.body}
        testID={`diagnostics-panel-${selectedTab}`}
      >
        <View style={styles.summary}>
          <MobileListRow description={observationCopy} testID="diagnostics-observation" title="Observation" />
          <MobileListRow description={collectionCopy} testID="diagnostics-collection" title="Collection" />
        </View>
        <Text
          selectable
          style={mobileType.body}
          testID="diagnostics-redaction-copy"
        >
          {DIAGNOSTICS_REDACTION_COPY}
        </Text>
        <MobileButton
          accessibilityHint="Starts a bounded Capability Profile collection run"
          accessibilityLabel="Run check"
          onPress={onRunCheck}
          testID="run-check"
          variant="primary"
        >
          Run check
        </MobileButton>
        {slots[selectedTab]}
      </MobileRefreshableScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  tabs: {
    borderBottomColor: mobileColors.dividerMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabRow: {
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    gap: mobileSpacing.large,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  summary: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
  },
});
