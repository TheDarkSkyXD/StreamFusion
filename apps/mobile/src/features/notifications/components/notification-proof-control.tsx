import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

export function NotificationProofControl({
  onPresent,
  registrationCopy,
}: {
  readonly onPresent: () => Promise<void>;
  readonly registrationCopy?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.card}>
      <Text selectable style={styles.title}>
        Notification proof
      </Text>
      <Text selectable style={styles.body}>
        Present a local live-alert on the Live channel. One event uses a topic
        or a direct token, never both. Overflow past 2000 topics stays direct.
        Activity still records if FCM is unavailable.
      </Text>
      {registrationCopy ? (
        <Text
          selectable
          style={styles.body}
          testID="notification-reconciliation-status"
        >
          {registrationCopy}
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel="Present notification proof"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void onPresent().finally(() => setBusy(false));
        }}
        style={styles.action}
        testID="present-notification-proof"
      >
        <Text selectable style={styles.actionLabel}>
          Present live-alert proof
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  body: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
});
