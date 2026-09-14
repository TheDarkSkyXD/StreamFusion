import { requireNativeViewManager } from "expo-modules-core";
import { StyleSheet, View } from "react-native";

export type PlayerSurfaceProps = {
  readonly sessionId: string;
  readonly testID?: string;
};

type NativePlaybackViewProps = {
  readonly sessionId: string;
  readonly style?: object;
  readonly testID?: string;
};

let NativePlaybackView:
  | ReturnType<typeof requireNativeViewManager<NativePlaybackViewProps>>
  | null = null;
try {
  NativePlaybackView =
    requireNativeViewManager<NativePlaybackViewProps>("StreamFusionPlayback");
} catch {
  NativePlaybackView = null;
}

export function AndroidMedia3PlayerSurface({
  sessionId,
  testID,
}: PlayerSurfaceProps) {
  const testProps = testID === undefined ? {} : { testID };
  if (!NativePlaybackView) {
    return <View style={styles.surface} {...testProps} />;
  }
  return (
    <NativePlaybackView
      sessionId={sessionId}
      style={styles.surface}
      {...testProps}
    />
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
  },
});
