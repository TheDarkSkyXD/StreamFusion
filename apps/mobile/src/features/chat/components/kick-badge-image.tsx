import { Image } from "react-native";
import { SvgXml } from "react-native-svg";

export function KickBadgeImage({
  imageUrl,
  title,
  testID,
}: {
  readonly imageUrl: string;
  readonly title: string;
  readonly testID: string;
}) {
  if (imageUrl.startsWith("data:image/svg+xml,")) {
    return (
      <SvgXml
        accessibilityLabel={title}
        height={18}
        testID={testID}
        width={18}
        xml={decodeURIComponent(imageUrl.slice("data:image/svg+xml,".length))}
      />
    );
  }
  return (
    <Image
      accessibilityLabel={title}
      resizeMode="contain"
      source={{ uri: imageUrl }}
      style={{ width: 18, height: 18 }}
      testID={testID}
    />
  );
}
