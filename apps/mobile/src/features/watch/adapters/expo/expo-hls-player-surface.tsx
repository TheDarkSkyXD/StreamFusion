import { useEffect, useReducer } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { VideoView } from "expo-video";

import type { PlayerSurfaceProps } from "../android/android-media3-player-surface";
import {
  getExpoHlsPlaybackEntry,
  subscribeExpoHlsRegistry,
} from "./expo-hls-playback-registry";

/**
 * Expo Go Watch player surface.
 *
 * Android default SurfaceView punches a hole through the window and mis-composites
 * under Watch overlays (tap catcher, controls, caption, mini-player scrim). That
 * shows up as a green wash over the video and a purple fringe on the stage edge.
 * TextureView keeps the frames in the normal view hierarchy so overlays stay clean.
 */
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
      surfaceType={Platform.OS === "android" ? "textureView" : undefined}
      useExoShutter={false}
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