import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "./button";
import { MobileStatusPanel, type MobileStatusTone } from "./status-panel";
import { mobileColors, mobileSpacing, mobileType } from "./tokens";

export type MobileListPhase = "loading" | "empty" | "error" | "ready";

/**
 * Consistent loading / empty / error presentation for list screens.
 * Prefer skeleton-like calm spinner for loading; honest copy + retry on failure.
 */
export function MobileListState({
  children,
  message,
  onRetry,
  phase,
  testID,
  title,
}: {
  readonly children?: ReactNode;
  readonly message: string;
  readonly onRetry?: () => void;
  readonly phase: Exclude<MobileListPhase, "ready">;
  readonly testID?: string;
  readonly title?: string;
}) {
  const tone: MobileStatusTone =
    phase === "error" ? "error" : phase === "loading" ? "loading" : "empty";
  return (
    <MobileStatusPanel
      {...(testID === undefined ? {} : { testID })}
      tone={tone}
    >
      {phase === "loading" ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={mobileColors.textSecondary} />
          <Text selectable style={mobileType.body}>
            {message}
          </Text>
        </View>
      ) : (
        <>
          {title ? (
            <Text selectable style={mobileType.title}>
              {title}
            </Text>
          ) : null}
          <Text selectable style={mobileType.body}>
            {message}
          </Text>
          {onRetry && phase === "error" ? (
            <MobileButton
              accessibilityLabel="Retry"
              onPress={onRetry}
              testID={testID ? `${testID}-retry` : "list-state-retry"}
              variant="secondary"
            >
              Retry
            </MobileButton>
          ) : null}
          {children}
        </>
      )}
    </MobileStatusPanel>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
});
