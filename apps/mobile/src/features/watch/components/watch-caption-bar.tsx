import { useTranslation } from "react-i18next";
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
  readonly compact?: boolean;
  readonly eligibility: WatchCaptionEligibility;
  readonly model: CaptionModelState | null;
  /** Kept for route wiring; Watch never offers model install (Settings-only later). */
  readonly onInstall?: () => void;
  /** Kept for route wiring; Watch never offers model remove. */
  readonly onRemove?: () => void;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly session: CaptionSessionState | null;
  readonly status?: string | null;
};

/**
 * Watch caption chrome — start/stop only when a model is already present.
 * Model install/download prompts do not live on Watch.
 */
export function WatchCaptionBar({
  busy = false,
  compact = false,
  eligibility,
  model,
  onStart,
  onStop,
  session,
  status,
}: WatchCaptionBarProps) {
  const { t } = useTranslation();
  if (eligibility.kind === "hidden") return null;
  if (eligibility.kind === "unsupported") {
    if (compact) return null;
    return (
      <MobileStatusPanel testID="watch-captions" tone="info">
        <Text selectable style={mobileType.body} testID="watch-captions-unsupported">
          {eligibility.reason}
        </Text>
      </MobileStatusPanel>
    );
  }
  const installed = model?.installed === true;
  // No install / download CTA on Watch — hide until a model already exists.
  if (!installed) return null;

  const active = session?.state === "active";
  const actions = captionSessionActions(active, (key) => t(key), {
    onStart,
    onStop,
  });
  if (actions.length === 0) return null;

  if (compact) {
    return (
      <View style={styles.compact} testID="watch-captions">
        <View style={styles.actions}>
          {actions.map((action) => (
            <Action busy={busy} key={action.testID} {...action} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <MobileStatusPanel testID="watch-captions" tone="info">
      <Text selectable style={mobileType.body} testID="watch-captions-status">
        {status ?? session?.reason ?? model?.statusMessage ?? ""}
      </Text>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Action busy={busy} key={action.testID} {...action} />
        ))}
      </View>
    </MobileStatusPanel>
  );
}

function captionSessionActions(
  active: boolean,
  t: (key: string) => string,
  handlers: {
    readonly onStart: () => void;
    readonly onStop: () => void;
  },
) {
  if (active) {
    return [
      {
        label: t("playback.watch.stopCaptions"),
        onPress: handlers.onStop,
        testID: "watch-captions-stop",
      },
    ];
  }
  return [
    {
      label: t("playback.watch.startCaptions"),
      onPress: handlers.onStart,
      testID: "watch-captions-start",
    },
  ];
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
      variant="secondary"
    >
      {label}
    </MobileButton>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  compact: { gap: mobileSpacing.xSmall },
});
