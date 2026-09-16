import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { mobileColors, mobileRadii, mobileSpacing } from "./tokens";

export type MobileStatusTone = "info" | "empty" | "loading" | "error";

export function MobileStatusPanel({
  children,
  testID,
  tone,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
  readonly tone: MobileStatusTone;
}) {
  return (
    <View
      {...(testID === undefined ? {} : { testID })}
      style={[styles.panel, tone === "error" ? styles.error : null]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.large,
  },
  error: {
    backgroundColor: mobileColors.surfaceRaised,
  },
});
