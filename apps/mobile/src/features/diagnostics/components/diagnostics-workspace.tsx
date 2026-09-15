import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
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

function diagnosticsTab(input: {
  readonly onSelect: (tab: MobileDiagnosticsTab) => void;
  readonly selected: boolean;
  readonly tab: MobileDiagnosticsTab;
}): ReactNode {
  return (
    <Pressable
      accessibilityLabel={DIAGNOSTICS_TAB_LABELS[input.tab]}
      accessibilityRole="tab"
      accessibilityState={{ selected: input.selected }}
      key={input.tab}
      onPress={() => input.onSelect(input.tab)}
      style={[styles.tab, input.selected ? styles.tabSelected : null]}
      testID={`diagnostics-tab-${input.tab}`}
    >
      <Text
        selectable
        style={[styles.tabText, input.selected ? styles.tabTextSelected : null]}
      >
        {DIAGNOSTICS_TAB_LABELS[input.tab]}
      </Text>
    </Pressable>
  );
}

function diagnosticsRunCheck(onRunCheck: () => void): ReactNode {
  return (
    <Pressable
      accessibilityHint="Starts a bounded Capability Profile collection run"
      accessibilityLabel="Run check"
      accessibilityRole="button"
      onPress={onRunCheck}
      style={({ pressed }) => [styles.check, pressed ? styles.pressed : null]}
      testID="run-check"
    >
      <Text selectable style={styles.checkLabel}>
        Run check
      </Text>
    </Pressable>
  );
}

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
          {MOBILE_DIAGNOSTICS_TABS.map((tab) =>
            diagnosticsTab({
              onSelect: onSelectTab,
              selected: tab === selectedTab,
              tab,
            }),
          )}
        </ScrollView>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        nestedScrollEnabled
        style={styles.body}
        testID={`diagnostics-panel-${selectedTab}`}
      >
        <Text selectable style={styles.meta} testID="diagnostics-observation">
          {observationCopy}
        </Text>
        <Text selectable style={styles.meta} testID="diagnostics-collection">
          {collectionCopy}
        </Text>
        <Text selectable style={styles.meta} testID="diagnostics-redaction-copy">
          {DIAGNOSTICS_REDACTION_COPY}
        </Text>
        {diagnosticsRunCheck(onRunCheck)}
        {slots[selectedTab]}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  tabs: {
    borderBottomColor: mobileColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabRow: {
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  tab: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.full,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  tabSelected: {
    backgroundColor: mobileColors.navigationSelected,
  },
  tabText: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  tabTextSelected: {
    color: mobileColors.textPrimary,
    fontWeight: "700",
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
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  check: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  checkLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.85,
  },
});
