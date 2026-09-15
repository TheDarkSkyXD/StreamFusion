import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { InAppNotificationBanner } from "../capabilities/native-notifications";

export function InAppNotificationBannerView({
  banner,
  onDismiss,
  onOpen,
}: {
  readonly banner: InAppNotificationBanner;
  readonly onDismiss: () => void;
  readonly onOpen: () => void;
}) {
  return (
    <View style={styles.card} testID="in-app-notification-banner">
      <Text selectable style={styles.title}>
        {banner.title}
      </Text>
      <Text selectable style={styles.body}>
        {banner.body}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Watch from notification"
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.action}
          testID="notification-watch"
        >
          <Text selectable style={styles.actionLabel}>
            Watch
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Dismiss notification"
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.action}
          testID="notification-dismiss"
        >
          <Text selectable style={styles.actionLabel}>
            Dismiss
          </Text>
        </Pressable>
      </View>
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
  actions: {
    flexDirection: "row",
    gap: mobileSpacing.medium,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
});
