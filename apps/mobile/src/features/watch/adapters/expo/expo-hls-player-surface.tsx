import { useEffect, useReducer } from "react";
import { StyleSheet, View } from "react-native";
import { VideoView } from "expo-video";

import type { PlayerSurfaceProps } from "../android/android-media3-player-surface";
import {
  getExpoHlsPlaybackEntry,
  subscribeExpoHlsRegistry,
} from "./expo-hls-playback-registry";

export function ExpoHlsPlayerSurface({
  sessionId,
  testID,
}: PlayerSurfaceProps) {
  const testProps = testID === undefined ? {} : { testID };
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeExpoHlsRegistry(() => bump()), []);
  const player = getExpoHlsPlaybackEntry(sessionId)?.player;

  if (!player) {
    return <View style={styles.surface} {...testProps} />;
  }

  return (
    <VideoView
      contentFit="contain"
      nativeControls={false}
      player={player}
      style={styles.surface}
      {...testProps}
    />
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: "#000000",
    flex: 1,
  },
});