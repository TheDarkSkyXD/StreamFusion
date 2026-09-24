import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";

import type { WatchCaptionEligibility } from "../domain/watch-captions";

export type WatchCaptionBarProps = {
  readonly compact?: boolean;
  readonly eligibility: WatchCaptionEligibility;
  readonly busy?: boolean;
  readonly model?: unknown;
  readonly onInstall?: () => void;
  readonly onRemove?: () => void;
  readonly onStart?: () => void;
  readonly onStop?: () => void;
  readonly session?: unknown;
  readonly status?: string | null;
};

/** Watch CC Coming soon - no model download on Watch. */
export function WatchCaptionBar({
  compact = false,
  eligibility,
}: WatchCaptionBarProps) {
  const { t } = useTranslation();
  if (eligibility.kind === "hidden") return null;

  const title = t("playback.watch.captionsComingSoon", {
    defaultValue: "Coming soon",
  });
  const detail = t("playback.watch.captionsComingSoonDetail", {
    defaultValue:
      "Closed captions while watching will ship without downloading a speech model on this screen.",
  });

  if (compact) {
    return (
      <View
        accessibilityLabel={title + ". " + detail}
        style={styles.compact}
        testID="watch-captions"
      >
        <Text selectable style={mobileType.label} testID="watch-captions-coming-soon">
          {title}
        </Text>
      </View>
    );
  }

  return (
    <MobileStatusPanel testID="watch-captions" tone="info">
      <Text selectable style={mobileType.title} testID="watch-captions-coming-soon">
        {title}
      </Text>
      <Text selectable style={mobileType.body} testID="watch-captions-coming-soon-detail">
        {detail}
      </Text>
    </MobileStatusPanel>
  );
}

const styles = StyleSheet.create({
  compact: { gap: mobileSpacing.xSmall },
});
