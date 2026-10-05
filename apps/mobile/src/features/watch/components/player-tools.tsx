import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileChoiceGroup } from "@mobile/design/choice-group";
import { MobileListRow } from "@mobile/design/list-row";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  FocusedWatchSession,
  PlaybackObservationResult,
} from "../capabilities/watch";

export function PlayerTools({
  session,
  sessionId,
  recorded,
}: {
  readonly session: FocusedWatchSession;
  readonly sessionId: string;
  readonly recorded: boolean;
}) {
  const [tool, setTool] = useState<"speed" | "stats" | null>(null);
  const [result, setResult] = useState<PlaybackObservationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const revision = ++generation.current;
    if (!tool) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const observed = await session.readPlaybackObservation?.();
      if (stopped || revision !== generation.current) return;
      setResult(
        observed ?? {
          kind: "unavailable",
          failure: {
            code: "OPERATION_UNSUPPORTED",
            detail: "Playback observations are unavailable in this host.",
          },
        },
      );
      timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      generation.current = revision + 1;
    };
  }, [session, sessionId, tool]);
  const observation =
    result?.kind === "observed" && result.observation.sessionId === sessionId
      ? result.observation
      : null;
  const changeSpeed = async (speed: string) => {
    if (busy) return;
    const revision = generation.current;
    setBusy(true);
    const changed = await session.setPlaybackSpeed?.(Number(speed));
    if (revision !== generation.current) return;
    setResult(
      changed ?? {
        kind: "unavailable",
        failure: {
          code: "OPERATION_UNSUPPORTED",
          detail: "Playback speed is unavailable in this host.",
        },
      },
    );
    setBusy(false);
  };
  return (
    <>
      <View
        style={{
          flexDirection: "row",
          gap: mobileSpacing.small,
          paddingHorizontal: mobileSpacing.medium,
        }}
      >
        {recorded ? (
          <MobileButton
            accessibilityLabel="Playback speed"
            testID="player-speed"
            variant="ghost"
            onPress={() => {
              setResult(null);
              setBusy(false);
              setTool("speed");
            }}
          >
            Playback speed
          </MobileButton>
        ) : null}
        <MobileButton
          accessibilityLabel="Video stats"
          testID="player-stats"
          variant="ghost"
          onPress={() => {
            setResult(null);
            setBusy(false);
            setTool("stats");
          }}
        >
          Video stats
        </MobileButton>
      </View>
      <MobileBottomSheet
        title={tool === "speed" ? "Playback speed" : "Video stats"}
        visible={tool !== null}
        onDismiss={() => setTool(null)}
      >
        {result?.kind === "unavailable" ? (
          <Text style={mobileType.body}>{result.failure.detail}</Text>
        ) : null}
        {tool === "speed" && observation ? (
          <MobileChoiceGroup
            label={busy ? "Applying playback speed" : "Playback speed"}
            value={String(observation.speed)}
            options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => ({
              value: String(speed),
              label: `${speed}×${speed === 1 ? " · Normal" : ""}`,
            }))}
            onChange={(speed) => void changeSpeed(speed)}
          />
        ) : null}
        {tool === "stats" && observation ? (
          <>
            <Text style={mobileType.label}>
              Current playback session · {sessionId}
            </Text>
            <MobileListRow
              title="Resolution"
              description={
                observation.width && observation.height
                  ? `${observation.width} × ${observation.height}`
                  : "Unavailable in this host"
              }
            />
            <MobileListRow
              title="Frame rate"
              description={
                observation.frameRate === null
                  ? "Unavailable in this host"
                  : `${observation.frameRate} fps`
              }
            />
            <MobileListRow
              title="Dropped frames"
              description={
                observation.droppedFrames === null
                  ? "Unavailable in this host"
                  : `${observation.droppedFrames} / ${observation.renderedFrames ?? "unknown"} rendered`
              }
            />
            <MobileListRow
              title="Buffered"
              description={`${(observation.bufferedMs / 1000).toFixed(1)} seconds`}
            />
            <MobileListRow
              title="Bitrate"
              description={
                observation.bitrate === null
                  ? "Unavailable in this host"
                  : `${(observation.bitrate / 1000000).toFixed(2)} Mbps`
              }
            />
            <MobileListRow
              title="Codec"
              description={observation.codec ?? "Unavailable in this host"}
            />
          </>
        ) : null}
        {!result ? (
          <Text style={mobileType.body}>Reading current player…</Text>
        ) : null}
      </MobileBottomSheet>
    </>
  );
}
