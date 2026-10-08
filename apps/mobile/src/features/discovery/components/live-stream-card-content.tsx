import { StyleSheet, View } from "react-native";
import { MobileMediaCardContent } from "@mobile/design/media-card";
import { MobileTag } from "@mobile/design/tag";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import { mobileSpacing } from "@mobile/design/tokens";
import type { Stream } from "@streamfusion/core/content";
import { languageLabel } from "../domain/broadcast-languages";
import { isBroadcastLanguage } from "../utils/broadcast-languages";

const viewerCountFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function LiveStreamCardContent({
  compact = false,
  stream,
  tagsTestID,
}: {
  readonly compact?: boolean;
  readonly stream: Stream;
  readonly tagsTestID?: string;
}) {
  const languageCode = stream.language?.toLowerCase();
  const language =
    languageCode && isBroadcastLanguage(languageCode)
      ? languageLabel(languageCode)
      : stream.language;
  const tagLabels = language ? [language] : [];
  const extraTag = stream.tags.find(
    (tag) => tag.trim() !== "" && tag.toLowerCase() !== languageCode,
  );
  if (extraTag) tagLabels.push(extraTag);
  return (
    <MobileMediaCardContent
      compact={compact}
      channel={stream.channelDisplayName}
      title={stream.title}
      {...(stream.categoryName ? { category: stream.categoryName } : {})}
      platform={stream.platform}
      live={stream.isLive}
      avatarUri={stream.channelAvatar}
      thumbnailUri={stream.thumbnailUrl}
      viewerLabel={`${viewerCountFormatter.format(stream.viewerCount)} viewers`}
      viewerAccessibilityLabel={`${stream.viewerCount} viewers`}
      viewerTestID="stream-viewer-count"
      metadata={
        stream.channelIsVerified ? (
          <MobileVerifiedBadge platform={stream.platform} />
        ) : null
      }
      tags={
        tagLabels.length || stream.isMature ? (
          <View style={styles.tags} testID={tagsTestID}>
            {tagLabels.map((tag) => (
              <MobileTag key={tag} label={tag} />
            ))}
            {stream.isMature ? <MobileTag label="18+" /> : null}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  tags: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.xSmall },
});
