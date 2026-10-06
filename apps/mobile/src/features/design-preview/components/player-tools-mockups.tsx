import { useState } from "react";
import { Text, View } from "react-native";

import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileChoiceGroup } from "@mobile/design/choice-group";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileProgress, MobileSnackbar } from "@mobile/design/feedback";
import { mobileType } from "@mobile/design/tokens";

import { PreviewPlayer } from "./catalog-elements";
import { PreviewFrame, previewStyles as ui } from "./preview-frame";

export function PlayerToolsMockup({
  kind,
}: {
  readonly kind: "speed" | "stats" | "volume";
}) {
  const [open, setOpen] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState("1");
  const [volume, setVolume] = useState(80);
  const [notice, setNotice] = useState("");
  const title =
    kind === "speed"
      ? "Playback speed"
      : kind === "stats"
        ? "Video Stats"
        : "Volume";
  return (
    <>
      <PreviewFrame title="Recorded broadcast" destination="watch">
        <PreviewPlayer
          media="video"
          playing={playing}
          onPlay={() => setPlaying(!playing)}
        />
        <Text style={mobileType.body}>
          Proposed player tools · local preview
        </Text>
        <MobileButton
          accessibilityLabel={`Open ${title}`}
          testID="open-player-tool"
          variant="secondary"
          onPress={() => setOpen(true)}
        >
          {title}
        </MobileButton>
        {notice ? (
          <MobileSnackbar
            message={notice}
            actionLabel="Dismiss"
            onAction={() => setNotice("")}
          />
        ) : null}
      </PreviewFrame>
      <MobileBottomSheet
        title={title}
        visible={open}
        onDismiss={() => setOpen(false)}
      >
        {kind === "speed" ? (
          <MobileChoiceGroup
            label="Playback speed"
            value={speed}
            options={["0.5", "0.75", "1", "1.25", "1.5", "2"].map((value) => ({
              value,
              label: `${value}×${value === "1" ? " · Normal" : ""}`,
            }))}
            onChange={(value) => {
              setSpeed(value);
              setOpen(false);
              setNotice(`Playback speed · ${value}×`);
            }}
          />
        ) : null}
        {kind === "stats" ? (
          <>
            <Text style={mobileType.label}>
              Illustrative values. No decoder is running.
            </Text>
            {[
              ["Resolution", "1920 × 1080"],
              ["FPS", "60 fps"],
              ["Skipped Frames", "2 / 4,320"],
              ["Buffer Size", "12 seconds"],
              ["Bitrate", "6.2 Mbps"],
              ["Codecs", "H.264"],
            ].map(([label, value]) => (
              <MobileListRow
                key={label}
                title={label ?? ""}
                description={value ?? ""}
              />
            ))}
          </>
        ) : null}
        {kind === "volume" ? (
          <>
            <MobileProgress label="Volume" value={volume / 100} />
            <View style={ui.row}>
              <MobileButton
                accessibilityLabel="Decrease volume"
                testID="volume-down"
                variant="secondary"
                disabled={volume === 0}
                onPress={() => setVolume(Math.max(0, volume - 10))}
              >
                − 10%
              </MobileButton>
              <MobileButton
                accessibilityLabel="Increase volume"
                testID="volume-up"
                variant="secondary"
                disabled={volume === 100}
                onPress={() => setVolume(Math.min(100, volume + 10))}
              >
                + 10%
              </MobileButton>
            </View>
            <MobileButton
              accessibilityLabel={volume ? "Mute" : "Unmute"}
              testID="volume-mute"
              variant="ghost"
              onPress={() => setVolume(volume ? 0 : 80)}
            >
              {volume ? "Mute" : "Unmute"}
            </MobileButton>
          </>
        ) : null}
      </MobileBottomSheet>
    </>
  );
}
