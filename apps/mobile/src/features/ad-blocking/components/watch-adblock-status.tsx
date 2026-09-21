import { Text } from "react-native";

import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileType } from "@mobile/design/tokens";
import type { AdBlockView } from "../capabilities/ad-blocking";
import type { Platform } from "@streamfusion/core/platform";

export function WatchAdBlockStatus({
  platform,
  view,
}: {
  readonly platform: Platform;
  readonly view: AdBlockView | null;
}) {
  const detail = statusDetail(platform, view);
  return (
    <MobileStatusPanel testID="watch-adblock-status" tone="info">
      <Text selectable style={mobileType.title}>
        {view?.title ?? "Playback filtering"}
      </Text>
      <Text selectable style={mobileType.body}>
        {detail}
      </Text>
    </MobileStatusPanel>
  );
}

function statusDetail(platform: Platform, view: AdBlockView | null): string {
  if (!view) return "Reading playback filtering.";
  if (platform === "kick") {
    return "Kick has no approved filter. This Watch session is unfiltered.";
  }
  return view.detail;
}
