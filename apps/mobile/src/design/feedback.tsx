import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export function MobileSnackbar({
  actionLabel,
  message,
  onAction,
}: {
  readonly actionLabel: string;
  readonly message: string;
  readonly onAction: () => void;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.snackbar}>
      <Text style={[mobileType.body, styles.message]}>{message}</Text>
      <Pressable
        accessibilityLabel={actionLabel}
        accessibilityRole="button"
        onPress={onAction}
        style={styles.action}
      >
        <Text style={styles.actionLabel}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

export function MobileProgress({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={styles.progressWrap}
    >
      <View style={styles.progressCopy}>
        <Text style={mobileType.label}>{label}</Text>
        <Text style={mobileType.label}>{percent}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

export function MobileSkeleton({
  kind = "row",
}: {
  readonly kind?: "row" | "card";
}) {
  return (
    <View
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
      style={styles.skeleton}
    >
      {kind === "card" ? <View style={styles.thumbnail} /> : null}
      <View style={styles.skeletonRow}>
        <View style={styles.avatar} />
        <View style={styles.lines}>
          <View style={styles.line} />
          <View style={styles.shortLine} />
        </View>
      </View>
    </View>
  );
}

export function MobileLoadingSpinner({ label }: { readonly label: string }) {
  return (
    <View style={styles.spinner}>
      <ActivityIndicator
        accessibilityLabel={label}
        color={mobileColors.textSecondary}
      />
      <Text style={mobileType.body}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  snackbar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.large,
    flexDirection: "row",
    gap: mobileSpacing.small,
    alignItems: "center",
    paddingLeft: mobileSpacing.medium,
    paddingRight: mobileSpacing.small,
  },
  message: {
    flex: 1,
    color: mobileColors.textPrimary,
    paddingVertical: mobileSpacing.small,
  },
  action: {
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    paddingHorizontal: mobileSpacing.small,
  },
  actionLabel: { ...mobileType.title, fontSize: 14 },
  progressWrap: { gap: mobileSpacing.small },
  progressCopy: { flexDirection: "row", justifyContent: "space-between" },
  track: {
    height: 4,
    backgroundColor: mobileColors.border,
    borderRadius: mobileRadii.full,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: mobileColors.textPrimary },
  skeleton: { gap: mobileSpacing.medium, paddingVertical: mobileSpacing.small },
  thumbnail: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.large,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: mobileSpacing.small,
    alignItems: "center",
  },
  avatar: {
    width: 40,
    height: 40,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.full,
  },
  lines: { flex: 1, gap: mobileSpacing.small },
  line: {
    height: 12,
    width: "75%",
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.small,
  },
  shortLine: {
    height: 10,
    width: "45%",
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.small,
  },
  spinner: {
    flexDirection: "row",
    gap: mobileSpacing.small,
    alignItems: "center",
  },
});
