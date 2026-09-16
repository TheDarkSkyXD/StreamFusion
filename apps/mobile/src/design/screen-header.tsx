import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { mobileSpacing, mobileType } from "./tokens";

export function MobileScreenHeader({
  action,
  summary,
  title,
}: {
  readonly action?: ReactNode;
  readonly summary?: string;
  readonly title: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" selectable style={mobileType.display}>
          {title}
        </Text>
        {summary ? (
          <Text selectable style={mobileType.body}>
            {summary}
          </Text>
        ) : null}
      </View>
      {action ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
});
