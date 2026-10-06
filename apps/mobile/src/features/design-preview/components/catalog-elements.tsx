import { Play } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { MobileAvatar } from "@mobile/design/avatar";
import { MobileMediaCardContent } from "@mobile/design/media-card";
import {
  mobileColors as colors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

export const fixtureStreams = [
  {
    name: "aurora",
    title: "One more adventure before sunrise",
    category: "Minecraft",
    viewers: "12.4K",
    platform: "twitch",
    scene: "valley",
  },
  {
    name: "atlas",
    title: "Ranked with the crew • road to diamond",
    category: "VALORANT",
    viewers: "8.2K",
    platform: "kick",
    scene: "city",
  },
  {
    name: "moss",
    title: "A quiet night in the mountains",
    category: "Just Chatting",
    viewers: "3.1K",
    platform: "twitch",
    scene: "coast",
  },
] as const;

export type FixtureStream = (typeof fixtureStreams)[number];

export function PreviewArtwork({
  scene = "valley",
}: {
  readonly scene?: FixtureStream["scene"];
}) {
  const palette = {
    valley: {
      sky: "#9baea5",
      far: "#647b6a",
      near: "#2d4940",
      ground: "#172c27",
      sun: "#e4d2ac",
    },
    city: {
      sky: "#989db0",
      far: "#566073",
      near: "#303c50",
      ground: "#182536",
      sun: "#ded6c4",
    },
    coast: {
      sky: "#b5a18a",
      far: "#797668",
      near: "#3c5a60",
      ground: "#24434b",
      sun: "#edd8ae",
    },
  }[scene];
  return (
    <Svg
      accessibilityLabel={`Illustrated ${scene} stream preview`}
      accessibilityRole="image"
      width="100%"
      height="100%"
      viewBox="0 0 400 225"
      preserveAspectRatio="xMidYMid slice"
    >
      <Rect width="400" height="225" fill={palette.sky} />
      <Circle cx="300" cy="56" r="26" fill={palette.sun} />
      <Path
        d="M0 150 75 60 144 118 220 40 305 130 400 90V225H0Z"
        fill={palette.far}
      />
      <Path
        d="M0 174 70 127 149 162 230 97 316 164 400 134V225H0Z"
        fill={palette.near}
      />
      <Path
        d="M0 205 110 183 220 207 340 178 400 191V225H0Z"
        fill={palette.ground}
      />
      {scene === "city" ? (
        <Path
          d="M25 185V95H56V185M83 185V72H109V185M330 185V111H368V185"
          stroke={palette.ground}
          strokeWidth="18"
        />
      ) : null}
      <Path
        d="m210 225 23-37 9-20 12-18"
        fill="none"
        stroke={palette.sun}
        strokeWidth="3"
        opacity="0.45"
      />
    </Svg>
  );
}

export function PreviewAvatar({
  name,
  size = 40,
}: {
  readonly name: string;
  readonly size?: number;
}) {
  return <MobileAvatar name={name} size={size} />;
}

export function PreviewStreamCard({
  compact = false,
  media = "live",
  onPress,
  stream = fixtureStreams[0],
}: {
  readonly compact?: boolean;
  readonly media?: "live" | "video" | "clip";
  readonly onPress: () => void;
  readonly stream?: FixtureStream;
}) {
  return (
    <Pressable
      accessibilityLabel={`Watch ${stream.name}, ${stream.title}, ${media === "live" ? `${stream.viewers} viewers` : media}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <MobileMediaCardContent
        compact={compact}
        live={media === "live"}
        channel={stream.name}
        title={stream.title}
        category={stream.category}
        platform={stream.platform}
        thumbnail={<PreviewArtwork scene={stream.scene} />}
        viewerLabel={
          media === "live"
            ? `${stream.viewers} viewers`
            : media === "clip"
              ? "00:42"
              : "2:18:05"
        }
      />
    </Pressable>
  );
}

export function PreviewPlayer({
  onPlay,
  playing,
  media = "live",
}: {
  readonly onPlay: () => void;
  readonly playing: boolean;
  readonly media?: "live" | "video" | "clip";
}) {
  return (
    <View style={styles.player}>
      <PreviewArtwork />
      <View style={styles.playerScrim} />
      <Pressable
        accessibilityLabel={playing ? "Pause preview" : "Play preview"}
        accessibilityRole="button"
        onPress={onPlay}
        style={styles.play}
      >
        {playing ? (
          <View style={styles.pause}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        ) : (
          <Play
            color={colors.textPrimary}
            size={28}
            fill={colors.textPrimary}
          />
        )}
      </Pressable>
      <View style={styles.playerLabel}>
        {media === "live" ? (
          <View style={styles.playerLive}>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : null}
        <Text style={styles.viewerText}>
          {media === "live"
            ? "12.4K viewers"
            : media === "clip"
              ? "Clip · 00:42"
              : "Recorded broadcast"}
        </Text>
        <Text style={styles.viewerText}>1080p60</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: mobileSpacing.small,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    borderColor: "transparent",
  },
  pressed: { borderColor: colors.border, backgroundColor: colors.surface },
  liveText: { ...mobileType.caption, color: colors.textPrimary },
  viewerText: { ...mobileType.caption },
  player: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  playerScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.playerScrim,
  },
  play: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: [{ translateX: -28 }, { translateY: -28 }],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
  },
  pause: { flexDirection: "row", gap: 6 },
  pauseBar: {
    width: 6,
    height: 24,
    backgroundColor: colors.textPrimary,
    borderRadius: 1,
  },
  playerLabel: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: 20,
  },
  playerLive: {
    backgroundColor: colors.live,
    borderRadius: mobileRadii.small,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
