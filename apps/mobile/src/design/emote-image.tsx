import { Image, Platform, requireNativeComponent, type StyleProp, type ImageStyle, type ViewProps } from "react-native";

const NativeEmote = Platform.OS === "android"
  ? requireNativeComponent<ViewProps & { readonly uri: string; readonly animated: boolean }>("StreamFusionEmoteImage")
  : null;

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
  if (NativeEmote) return (
    <NativeEmote uri={uri} animated={animated} accessibilityLabel={name} style={style} key={`${uri}:${animated}`} />
  );
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={name}
      resizeMode="contain"
      key={`${uri}:${animated}`}
      style={style}
    />
  );
}
