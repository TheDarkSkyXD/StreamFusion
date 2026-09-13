import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

export function NativeCapabilityStubProofControl({
  onRun,
}: {
  readonly onRun: () => Promise<{ readonly detail: string }>;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      setDetail((await onRun()).detail);
    } catch {
      setDetail("Android contract stub check could not complete. Retry.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={styles.panel} testID="native-capability-stub-proof">
      <Text selectable style={styles.label}>
        ANDROID CONTRACT CHECKS
      </Text>
      <Text selectable style={styles.body}>
        Media Jobs is a live contract. Remaining playback, captions, and
        maintenance stubs still return unsupported. This check cancels a
        nonexistent job without starting work, then reads Diagnostics.
      </Text>
      {detail ? (
        <Text
          selectable
          style={styles.body}
          testID="native-capability-stub-proof-result"
        >
          {detail}
        </Text>
      ) : null}
      <Pressable
        accessibilityHint="Runs remaining Android stub checks and a safe Media Jobs cancel"
        accessibilityLabel="Run Android contract checks"
        accessibilityRole="button"
        accessibilityState={{ disabled: running }}
        android_ripple={{ color: mobileColors.surfaceRaised }}
        disabled={running}
        onPress={() => void run()}
        style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
        testID="run-native-capability-stub-proof"
      >
        <Text selectable style={styles.buttonLabel}>
          {running ? "Running checks" : "Run Android contract checks"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: mobileColors.textSecondary, lineHeight: 20 },
  button: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
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
