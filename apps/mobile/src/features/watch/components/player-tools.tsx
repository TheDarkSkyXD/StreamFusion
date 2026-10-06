import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Activity, Timer } from "lucide-react-native";
import { MobileChoiceGroup } from "@mobile/design/choice-group";
import { MobileListRow } from "@mobile/design/list-row";
import { mobileColors, mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  FocusedWatchSession,
  PlaybackObservationResult,
} from "../capabilities/watch";

export function PlayerTools({
  session,
  sessionId,
  recorded,
  showStats = true,
  tool,
  onSelectTool,
}: {
  readonly session: Pick<
    FocusedWatchSession,
    "readPlaybackObservation" | "setPlaybackSpeed"
  >;
  readonly sessionId: string;
  readonly recorded: boolean;
  readonly showStats?: boolean;
  readonly tool: "menu" | "speed" | "stats";
  readonly onSelectTool: (tool: "speed" | "stats") => void;
}) {
  const [result, setResult] = useState<PlaybackObservationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const revision = ++generation.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      let observed: PlaybackObservationResult | undefined;
      try {
        observed = await session.readPlaybackObservation?.();
      } catch {
        observed = {
          kind: "unavailable",
          failure: {
            code: "INVOCATION_FAILED",
            detail: "The current player could not be read.",
          },
        };
      }
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
    if (tool !== "menu") void refresh();
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
    try {
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
    } catch {
      if (revision === generation.current)
        setResult({
          kind: "unavailable",
          failure: {
            code: "INVOCATION_FAILED",
            detail: "Playback speed could not be changed.",
          },
        });
    } finally {
      if (revision === generation.current) setBusy(false);
    }
  };
  return (
    <>
      {tool === "menu" ? (
        <View
          style={{
            gap: mobileSpacing.small,
            paddingHorizontal: mobileSpacing.medium,
          }}
        >
          {!recorded && !showStats ? (
            <Text style={mobileType.body}>
              Player controls are hidden in Settings.
            </Text>
          ) : null}
          {recorded ? (
            <MobileListRow
              title="Playback speed"
              testID="player-speed"
              leading={<Timer color={mobileColors.textPrimary} size={24} />}
              onPress={() => {
                setResult(null);
                onSelectTool("speed");
              }}
            />
          ) : null}
          {showStats ? (
            <MobileListRow
              title="Video Stats"
              testID="player-stats"
              leading={<Activity color={mobileColors.textPrimary} size={24} />}
              onPress={() => {
                setResult(null);
                onSelectTool("stats");
              }}
            />
          ) : null}
        </View>
      ) : null}
      {tool !== "menu" ? (
        <View style={{ gap: mobileSpacing.small }}>
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
              <MobileListRow
                title="Resolution"
                description={
                  observation.width && observation.height
                    ? `${observation.width} × ${observation.height}`
                    : "Unavailable in this host"
                }
              />
              <MobileListRow
                title="FPS"
                description={
                  observation.frameRate === null
                    ? "Unavailable in this host"
                    : `${observation.frameRate} fps`
                }
              />
              <MobileListRow
                title="Skipped Frames"
                description={
                  observation.droppedFrames === null
                    ? "Unavailable in this host"
                    : `${observation.droppedFrames} / ${observation.renderedFrames ?? "unknown"} rendered`
                }
              />
              <MobileListRow
                title="Buffer Size"
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
                title="Codecs"
                description={observation.codec ?? "Unavailable in this host"}
              />
            </>
          ) : null}
          {!result ? (
            <Text style={mobileType.body}>Reading current player…</Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}
