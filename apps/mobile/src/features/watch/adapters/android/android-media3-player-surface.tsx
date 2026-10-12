import { requireNativeComponent, StyleSheet, UIManager, View } from "react-native";

export type PlayerSurfaceProps = {
  readonly sessionId: string;
  readonly testID?: string;
};

type NativePlaybackViewProps = {
  readonly sessionId: string;
  readonly style?: object;
  readonly testID?: string;
};

const NativePlaybackView = UIManager.getViewManagerConfig("StreamFusionPlayback")
  ? requireNativeComponent<NativePlaybackViewProps>("StreamFusionPlayback")
  : null;

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
