import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileAvatar } from "@mobile/design/avatar";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";

import type { FollowingChannelRow } from "../capabilities/following-session";

export function FollowingChannelCard({
  onOpen,
  row,
}: {
  readonly onOpen: () => void;
  readonly row: FollowingChannelRow;
}) {
  const { t } = useTranslation();
  const avatarUrl = row.stream?.channelAvatar;
  const verified = row.stream?.channelIsVerified === true;
  const label = row.isLive
    ? `${row.follow.displayName} live on ${row.follow.platform}`
    : `${row.follow.displayName} on ${row.follow.platform}`;
  return (
    <Pressable
      accessibilityHint={
        row.isLive
          ? "Opens this live channel in Watch"
          : "Opens channel details"
      }
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`following-channel-${row.follow.platform}-${row.follow.channelId}`}
    >
      <View style={styles.heading}>
        <MobileAvatar
          name={row.follow.displayName}
          size={48}
          uri={avatarUrl ?? null}
        />
        <View style={styles.copy}>
          <View style={styles.nameRow}>
            <Text selectable style={styles.title}>
              {row.follow.displayName}
            </Text>
            {verified ? (
              <MobileVerifiedBadge platform={row.follow.platform} />
            ) : null}
          </View>
          <View style={styles.statusRow}>
            {row.isLive ? (
              <View style={styles.livePill}>
                <Text selectable style={styles.liveLabel}>
                  {t("discovery.live")}
                </Text>
              </View>
            ) : (
              <Text selectable style={styles.meta}>
                {t("discovery.offline")}
              </Text>
            )}
            <Text selectable style={styles.meta}>
              · {row.follow.platform}
            </Text>
          </View>
        </View>
        <MobilePlatformBadge platform={row.follow.platform} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: mobileSpacing.small,
  },
  pressed: {
    opacity: 0.76,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  title: {
    ...mobileType.title,
  },
  livePill: {
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
  },
  liveLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
    textTransform: "uppercase",
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
