import {
  LOCAL_CAPTION_DISPLAY_SIZE,
  LOCAL_CAPTION_NOT_INSTALLED_STATUS,
} from "@streamfusion/core/local-captions";
import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
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
      <MobileStatusPanel testID="watch-captions" tone="info">
        <Text selectable style={mobileType.body} testID="watch-captions-unsupported">
          {eligibility.reason}
        </Text>
      </MobileStatusPanel>
    );
  }
  const installed = model?.installed === true;
  const active = session?.state === "active";
  return (
    <MobileStatusPanel testID="watch-captions" tone="info">
      <Text selectable style={mobileType.body} testID="watch-captions-size">
        {model?.displaySize ?? LOCAL_CAPTION_DISPLAY_SIZE} English model
      </Text>
      <Text selectable style={mobileType.body} testID="watch-captions-status">
        {status ??
          session?.reason ??
          model?.statusMessage ??
          LOCAL_CAPTION_NOT_INSTALLED_STATUS}
      </Text>
      <Text selectable style={mobileType.label} testID="watch-captions-privacy">
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
    </MobileStatusPanel>
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
    <MobileButton
      accessibilityLabel={label}
      busy={busy}
      onPress={onPress}
      testID={testID}
      variant={testID === "watch-captions-remove" ? "destructive" : "secondary"}
    >
      {label}
    </MobileButton>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
});
