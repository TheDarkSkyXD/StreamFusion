import { Image } from "expo-image";
import type { StyleProp, ImageStyle } from "react-native";

export function MobileEmoteImage({
  uri,
  name,
  animated,
  style,
}: {
  readonly uri: string;
  readonly name: string;
  readonly animated: boolean;
  readonly style: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={name}
      autoplay={animated}
      contentFit="contain"
      cachePolicy="memory-disk"
      recyclingKey={`${uri}:${animated}`}
      style={style}
    />
  );
}
