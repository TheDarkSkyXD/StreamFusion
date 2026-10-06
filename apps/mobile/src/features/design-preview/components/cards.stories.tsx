import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState } from "react";
import { Text, View } from "react-native";

import { mobileSpacing, mobileType } from "@mobile/design/tokens";

import {
  fixtureStreams,
  PreviewAvatar,
  PreviewPlayer,
  PreviewStreamCard,
} from "./catalog-elements";
import { PreviewFrame } from "./preview-frame";

function CardsSample({
  kind = "stream",
}: {
  readonly kind?: "stream" | "compact" | "avatar" | "player" | "navigation";
}) {
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  if (kind === "navigation")
    return (
      <PreviewFrame title="StreamFusion" destination="watch">
        <Text style={mobileType.body}>
          Bottom navigation becomes a rail at 600 dp. The selection is local to
          this preview.
        </Text>
      </PreviewFrame>
    );
  return (
    <View style={{ padding: mobileSpacing.medium, gap: mobileSpacing.medium }}>
      {kind === "avatar" ? (
        <View style={{ flexDirection: "row", gap: 16 }}>
          {[24, 40, 56, 64].map((size) => (
            <PreviewAvatar name="aurora" size={size} key={size} />
          ))}
        </View>
      ) : kind === "player" ? (
        <PreviewPlayer playing={playing} onPlay={() => setPlaying(!playing)} />
      ) : (
        fixtureStreams.map((stream) => (
          <PreviewStreamCard
            compact={kind === "compact"}
            key={stream.name}
            stream={stream}
            onPress={() => setNotice(`${stream.name} selected`)}
          />
        ))
      )}
      {notice ? <Text style={mobileType.body}>{notice}</Text> : null}
    </View>
  );
}
const meta = {
  title: "Android/Components/Feature cards",
  component: CardsSample,
} satisfies Meta<typeof CardsSample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const StreamCards: Story = { args: { kind: "stream" } };
export const CompactMediaRows: Story = { args: { kind: "compact" } };
export const AvatarFallbacks: Story = { args: { kind: "avatar" } };
export const PlayerControls: Story = { args: { kind: "player" } };
export const AdaptiveNavigation: Story = { args: { kind: "navigation" } };
