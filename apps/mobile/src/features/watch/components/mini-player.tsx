import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  mobileColors,
  mobileRadii,
  mobileShadows,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { FocusedWatchSession, WatchPeek, WatchTarget } from "../capabilities/watch";
import {
  miniPlayerSnapStyle,
  type MiniPlayerSnapRegion,
} from "../domain/player-presentation";
import { useWatchPeek } from "./use-focused-watch-session";

const SNAP_CYCLE: readonly MiniPlayerSnapRegion[] = [
  "bottom-end",
  "bottom-start",
  "top-start",
  "top-end",
];

export function WatchMiniPlayerHost({
  hidden,
  onExpand,
  session,
}: {
  readonly hidden: boolean;
  readonly onExpand: (target: WatchTarget) => void;
  readonly session: FocusedWatchSession;
}) {
  const peek = useWatchPeek(session);
  if (hidden || peek.kind !== "active" || peek.presentation.presentation !== "mini") {
    return null;
  }
  return (
    <MiniPlayer
      onDismiss={() => {
        void session.dismiss();
      }}
      onExpand={() => onExpand(peek.state.target)}
      onPause={() => {
        void session.setPlaying(peek.state.phase === "paused");
      }}
      onRelocate={(region) => session.relocateMiniPlayer(region)}
      peek={peek}
    />
  );
}

export function MiniPlayer({
  onDismiss,
  onExpand,
  onPause,
  onRelocate,
  peek,
}: {
  readonly onDismiss: () => void;
  readonly onExpand: () => void;
  readonly onPause: () => void;
  readonly onRelocate: (region: MiniPlayerSnapRegion) => void;
  readonly peek: Extract<WatchPeek, { kind: "active" }>;
}) {
  const insets = useSafeAreaInsets();
  const paused = peek.state.phase === "paused";
  const nextRegion =
    SNAP_CYCLE[
      (SNAP_CYCLE.indexOf(peek.presentation.snapRegion) + 1) % SNAP_CYCLE.length
    ]!;
  return (
    <View
      accessibilityLabel={`${peek.state.target.channelName} mini-player`}
      style={[
        styles.shell,
        miniPlayerSnapStyle(peek.presentation.snapRegion, {
          bottom: insets.bottom + 72,
          top: insets.top,
        }),
      ]}
      testID="mini-player"
    >
      <Pressable
        accessibilityLabel="Expand mini-player"
        accessibilityRole="button"
        onPress={onExpand}
        style={styles.expand}
        testID="mini-player-expand"
      >
        <Text
          ellipsizeMode="tail"
          numberOfLines={1}
          selectable
          style={styles.title}
          testID="mini-player-title"
        >
          {peek.state.target.channelName}
        </Text>
        <Text selectable style={styles.meta}>
          {paused ? "Paused" : "Playing"} · Expand
        </Text>
      </Pressable>
      <Control
        label={paused ? "Resume" : "Pause"}
        onPress={onPause}
        testID="mini-player-pause"
      />
      <Control
        label={`Move to ${nextRegion}`}
        onPress={() => onRelocate(nextRegion)}
        testID="mini-player-relocate"
      />
      <Control label="Close" onPress={onDismiss} testID="dismiss-player" />
    </View>
  );
}

function Control({
  label,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed ? styles.controlPressed : null]}
      testID={testID}
    >
      <Text selectable style={styles.controlLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.large,
    boxShadow: mobileShadows.toast,
    flexDirection: "row",
    maxWidth: 320,
    position: "absolute",
    width: 280,
    zIndex: 20,
  },
  expand: {
    flex: 1,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: 0,
    paddingHorizontal: mobileSpacing.small,
  },
  title: {
    ...mobileType.title,
    fontSize: 14,
    lineHeight: 18,
  },
  meta: {
    ...mobileType.caption,
    color: mobileColors.textSecondary,
  },
  control: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.xSmall,
  },
  controlPressed: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  controlLabel: {
    ...mobileType.caption,
  },
});
