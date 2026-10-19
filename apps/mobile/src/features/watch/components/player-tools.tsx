import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
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
  tool,
}: {
  readonly session: Pick<
    FocusedWatchSession,
    "readPlaybackObservation" | "setPlaybackSpeed"
  >;
  readonly sessionId: string;
  readonly tool: "speed" | "stats";
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
    </>
  );
}
