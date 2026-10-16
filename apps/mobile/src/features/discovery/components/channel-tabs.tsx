import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import type { ChannelDetailTab } from "../capabilities/platform-reads";

const TABS: readonly ChannelDetailTab[] = ["home", "videos", "clips"];

export function ChannelTabs({
  onSelect,
  tab,
}: {
  readonly onSelect: (tab: ChannelDetailTab) => void;
  readonly tab: ChannelDetailTab;
}) {
  return (
    <MobileUnderlineTabs
      accessibilityLabel="Channel sections"
      onSelect={onSelect}
      selectedId={tab}
      tabs={TABS.map((id) => ({
        id,
        label: tabLabel(id),
        testID: `channel-tab-${id}`,
      }))}
      testID="channel-tabs"
    />
  );
}

function tabLabel(tab: ChannelDetailTab): string {
  if (tab === "home") return "Home";
  if (tab === "videos") return "Videos";
  return "Clips";
}
