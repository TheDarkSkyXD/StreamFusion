import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { RuntimeObservationDevelopmentProofResult } from "../capabilities/capability-profile";

export function DevelopmentResourceFailureProofControl({
  onQueue,
  onRetry,
}: {
  readonly onQueue: () => Promise<RuntimeObservationDevelopmentProofResult>;
  readonly onRetry: () => void;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const result = await onQueue();
      if (result.kind === "queued") {
        onRetry();
        setDetail("The next native resource read will fail once. This proves unavailable measurement handling only.");
      } else {
        setDetail(result.detail);
      }
    } catch {
      setDetail("Development failure proof could not be queued. Try again.");
    } finally {
      setRunning(false);
    }
  };
  return (
    <View style={styles.panel} testID="development-resource-failure-proof">
      <Text selectable style={styles.label}>
        DEVELOPMENT FAILURE PROOF
      </Text>
      <Text selectable style={styles.body}>
        Queues one real native bridge failure. It never simulates resource pressure, capacity, or qualification.
      </Text>
      {detail ? (
        <Text selectable style={styles.body} testID="development-resource-failure-proof-result">
          {detail}
        </Text>
      ) : null}
      <Pressable
        accessibilityHint="Queues one native resource measurement failure for development proof"
        accessibilityLabel="Run unavailable measurement proof"
        accessibilityRole="button"
        accessibilityState={{ disabled: running }}
        android_ripple={{ color: mobileColors.surfaceRaised }}
        disabled={running}
        onPress={() => void run()}
        style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
        testID="run-development-resource-failure-proof"
      >
        <Text selectable style={styles.buttonLabel}>
          {running ? "Queuing proof" : "Run unavailable measurement proof"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: mobileColors.textSecondary, lineHeight: 20 },
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  buttonLabel: { color: mobileColors.textPrimary, fontWeight: "700" },
  label: { color: mobileColors.textSecondary, fontSize: 12, fontWeight: "700" },
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  pressed: { opacity: 0.76 },
});
