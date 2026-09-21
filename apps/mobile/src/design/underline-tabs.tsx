import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileSizing,
  mobileSpacing,
} from "./tokens";

export type MobileUnderlineTabItem<T extends string> = {
  readonly accessibilityLabel?: string;
  readonly id: T;
  readonly label: string;
  readonly testID?: string;
};

export function MobileUnderlineTabs<T extends string>({
  accessibilityLabel,
  onSelect,
  selectedId,
  tabs,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly onSelect: (id: T) => void;
  readonly selectedId: T;
  readonly tabs: readonly MobileUnderlineTabItem<T>[];
  readonly testID?: string;
}) {
  return (
    <ScrollView
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tablist"
      contentContainerStyle={styles.row}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      testID={testID}
    >
      {tabs.map((tab) => {
        const selected = tab.id === selectedId;
        return (
          <Pressable
            accessibilityLabel={tab.accessibilityLabel ?? tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            style={({ pressed }) => [
              styles.tab,
              pressed ? styles.pressed : null,
            ]}
            testID={tab.testID}
          >
            <Text
              selectable
              style={[styles.label, selected ? styles.labelActive : null]}
            >
              {tab.label}
            </Text>
            <View
              style={[styles.underline, selected ? styles.underlineActive : null]}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: mobileSpacing.medium,
    paddingRight: mobileSpacing.small,
  },
  tab: {
    alignItems: "center",
    justifyContent: "flex-end",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingTop: mobileSpacing.small,
  },
  pressed: {
    opacity: 0.76,
  },
  label: {
    color: mobileColors.textMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    paddingBottom: mobileSpacing.small,
  },
  labelActive: {
    color: mobileColors.textPrimary,
  },
  underline: {
    alignSelf: "stretch",
    backgroundColor: "transparent",
    height: 2,
  },
  underlineActive: {
    backgroundColor: mobileColors.textPrimary,
  },
});
