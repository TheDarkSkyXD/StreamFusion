import { CaptionModelManagement } from "@mobile/features/local-captions/components/caption-model-management";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  CaptionModelState,
  CaptionSessionState,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { WatchCaptionEligibility } from "../domain/watch-captions";

export type WatchCaptionBarProps = {
  readonly compact?: boolean;
  readonly eligibility: WatchCaptionEligibility;
  readonly busy?: boolean;
  readonly model?: CaptionModelState | null;
  readonly onInstall?: () => void;
  readonly onRemove?: () => void;
  readonly onCancelInstall?: () => void;
  readonly onStart?: () => void;
  readonly onStop?: () => void;
  readonly session?: CaptionSessionState | null;
  readonly status?: string | null;
};

export function WatchCaptionBar({
  eligibility,
  busy = false,
  model,
  onInstall,
  onRemove,
  onCancelInstall,
  onStart,
  onStop,
  session,
  status,
}: WatchCaptionBarProps) {
  if (eligibility.kind === "hidden") return null;
  if (eligibility.kind === "unsupported") {
    return (
      <View style={styles.panel} testID="watch-captions-unavailable">
        <Text style={styles.heading}>Local captions</Text>
        <Text style={styles.status}>{eligibility.reason}</Text>
        <CaptionModelManagement
          busy={busy}
          model={model}
          onInstall={onInstall}
          onRemove={onRemove}
          onCancelInstall={onCancelInstall}
          status={status}
        />
      </View>
    );
  }
  const ready =
    model?.pack === "product" &&
    model.phase === "ready" &&
    model.installed &&
    model.sha256Verified;
  const active = session?.state === "active";
  const message =
    status ??
    (model?.pack === "fixture"
      ? "Diagnostics installed a test fixture. Download the English speech model to caption this stream."
      : (model?.statusMessage ??
        "Download the English speech model once. Captions then run offline on this device."));
  return (
    <View style={styles.panel} testID="watch-captions">
      <Text style={styles.heading}>Local captions · English</Text>
      <Text
        style={styles.status}
        accessibilityLiveRegion="polite"
        testID="watch-caption-status"
      >
        {busy ? "Working on local captions…" : message}
      </Text>
      <CaptionModelManagement
        busy={busy}
        model={model}
        onInstall={onInstall}
        onRemove={onRemove}
        onCancelInstall={onCancelInstall}
        status={status}
      />
      <View style={styles.actions}>
        {active ? (
          <Action
            label="Stop captions"
            testID="watch-caption-stop"
            onPress={onStop}
            disabled={busy}
          />
        ) : model?.phase === "constrained" ? (
          <Action
            label="Captions paused"
            testID="watch-caption-constrained"
            onPress={undefined}
            disabled
          />
        ) : ready ? (
          <Action
            label="Start captions"
            testID="watch-caption-start"
            onPress={onStart}
            disabled={busy}
          />
        ) : (
          <Action
            label="Download English model · 39.30 MiB"
            testID="watch-caption-install"
            onPress={onInstall}
            disabled={busy}
          />
        )}
        {model?.installed || model?.phase === "integrity-error" ? (
          <Action
            label="Remove model"
            testID="watch-caption-remove"
            onPress={onRemove}
            disabled={busy}
          />
        ) : null}
      </View>
      <Text style={styles.privacy}>
        Program audio only. No microphone. No audio upload.
      </Text>
    </View>
  );
}

function Action({
  label,
  testID,
  onPress,
  disabled,
}: {
  readonly label: string;
  readonly testID: string;
  readonly onPress: (() => void) | undefined;
  readonly disabled: boolean;
}) {
  const unavailable = disabled || onPress === undefined;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={[styles.action, unavailable && styles.disabled]}
      testID={testID}
    >
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
    flexGrow: 1,
    flexShrink: 1,
  },
  heading: { color: mobileColors.textPrimary, fontSize: 14, fontWeight: "700" },
  status: { color: mobileColors.textSecondary, fontSize: 13, lineHeight: 19 },
  privacy: { color: mobileColors.textSecondary, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  action: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  disabled: { opacity: 0.5 },
});
