import {
  LOCAL_CAPTION_DISPLAY_SIZE,
  LOCAL_CAPTION_NOT_INSTALLED_STATUS,
} from "@streamfusion/core/local-captions";
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
  readonly busy?: boolean;
  readonly eligibility: WatchCaptionEligibility;
  readonly model: CaptionModelState | null;
  readonly onInstall: () => void;
  readonly onRemove: () => void;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly session: CaptionSessionState | null;
  readonly status?: string | null;
};

export function WatchCaptionBar({
  busy = false,
  eligibility,
  model,
  onInstall,
  onRemove,
  onStart,
  onStop,
  session,
  status,
}: WatchCaptionBarProps) {
  if (eligibility.kind === "hidden") return null;
  if (eligibility.kind === "unsupported") {
    return (
      <View style={styles.panel} testID="watch-captions">
        <Text selectable style={styles.body} testID="watch-captions-unsupported">
          {eligibility.reason}
        </Text>
      </View>
    );
  }
  const installed = model?.installed === true;
  const active = session?.state === "active";
  return (
    <View style={styles.panel} testID="watch-captions">
      <Text selectable style={styles.body} testID="watch-captions-size">
        {model?.displaySize ?? LOCAL_CAPTION_DISPLAY_SIZE} English model
      </Text>
      <Text selectable style={styles.body} testID="watch-captions-status">
        {status ??
          session?.reason ??
          model?.statusMessage ??
          LOCAL_CAPTION_NOT_INSTALLED_STATUS}
      </Text>
      <Text selectable style={styles.meta} testID="watch-captions-privacy">
        Decoded program PCM stays on this device. No microphone. No upload.
      </Text>
      <View style={styles.actions}>
        {captionActions(installed, active, {
          onInstall,
          onRemove,
          onStart,
          onStop,
        }).map((action) => (
          <Action busy={busy} key={action.testID} {...action} />
        ))}
      </View>
    </View>
  );
}

function captionActions(
  installed: boolean,
  active: boolean,
  handlers: {
    readonly onInstall: () => void;
    readonly onRemove: () => void;
    readonly onStart: () => void;
    readonly onStop: () => void;
  },
) {
  const actions: {
    readonly label: string;
    readonly onPress: () => void;
    readonly testID: string;
  }[] = [];
  if (!installed) {
    actions.push({
      label: "Install English model",
      onPress: handlers.onInstall,
      testID: "watch-captions-install",
    });
  }
  if (installed && !active) {
    actions.push({
      label: "Start captions",
      onPress: handlers.onStart,
      testID: "watch-captions-start",
    });
  }
  if (active) {
    actions.push({
      label: "Stop captions",
      onPress: handlers.onStop,
      testID: "watch-captions-stop",
    });
  }
  if (installed) {
    actions.push({
      label: "Remove model",
      onPress: handlers.onRemove,
      testID: "watch-captions-remove",
    });
  }
  return actions;
}

function Action({
  busy,
  label,
  onPress,
  testID,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={styles.action}
      testID={testID}
    >
      <Text selectable style={styles.buttonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  body: { color: mobileColors.textPrimary, lineHeight: 20 },
  buttonLabel: { color: mobileColors.textPrimary, fontWeight: "700" },
  meta: { color: mobileColors.textSecondary, lineHeight: 18 },
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
});
