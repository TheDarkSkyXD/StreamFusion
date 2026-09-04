import { StatusBar } from "expo-status-bar";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { mobileColors, mobileSpacing } from "@mobile/design/tokens";

import type { DevelopmentClientViewModel } from "./development-client-controller";

export function DevelopmentClientScreen({
  model,
}: {
  readonly model: DevelopmentClientViewModel;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      testID="development-client-ready"
    >
      <View style={styles.content}>
        <Text accessibilityRole="header" selectable style={styles.title}>
          {model.title}
        </Text>
        <Text selectable style={styles.status}>
          {model.runtimeStatus}
        </Text>
        <Text selectable style={styles.detail}>
          {model.providerStatus}
        </Text>
        <Text selectable style={styles.detail} testID="runtime-layer-status">
          {model.layerStatus}
        </Text>
        <Text selectable style={styles.detail}>
          {model.version}
        </Text>
      </View>
      <StatusBar style="light" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: mobileColors.background,
    flexGrow: 1,
    justifyContent: "center",
    padding: mobileSpacing.large,
  },
  content: {
    alignItems: "center",
    gap: mobileSpacing.small,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 29,
  },
  status: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
    textAlign: "center",
  },
  detail: {
    color: mobileColors.textSecondary,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "500",
    lineHeight: 16,
    textAlign: "center",
  },
});
