import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, Heart } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MobileAvatar } from "@mobile/design/avatar";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import { MobileTag } from "@mobile/design/tag";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
  mobilePressedOpacity,
} from "@mobile/design/tokens";
import {
  isBroadcastLanguage,
  languageLabel,
} from "@mobile/features/discovery/domain/broadcast-languages";
import type { WatchInfo, WatchTarget } from "../capabilities/watch";
import {
  formatLiveUptime,
  formatWatchViewerCount,
} from "../domain/watch-live-meta";

export type WatchChannelCardProps = {
  readonly info: WatchInfo | null;
  readonly target: WatchTarget;
  readonly expanded: boolean;
  readonly followed: boolean;
  readonly followBusy: boolean;
  readonly liveAlerts?: boolean;
  readonly notificationsBusy?: boolean;
  readonly notificationStatus?: string | null;
  readonly onFollow?: () => void;
  readonly onOpenChannel?: () => void;
  readonly onToggleLiveAlerts?: () => void;
};

export function WatchChannelCard({
  info,
  target,
  expanded,
  followed,
  followBusy,
  liveAlerts = true,
  notificationsBusy = false,
  notificationStatus,
  onFollow,
  onOpenChannel,
  onToggleLiveAlerts,
}: WatchChannelCardProps) {
  const { i18n, t } = useTranslation();
  const name =
    info && info.kind !== "unavailable"
      ? info.channel.displayName
      : target.channelName;
  const channel = info && info.kind !== "unavailable" ? info.channel : null;
  const live = info?.kind === "live" ? info.stream : null;
  const [uptime, setUptime] = useState(() =>
    formatLiveUptime(live?.startedAt, Date.now()),
  );

  useEffect(() => {
    const tick = () => setUptime(formatLiveUptime(live?.startedAt, Date.now()));
    tick();
    if (!live?.startedAt) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [live?.startedAt]);

  const meta = live
    ? `${formatWatchViewerCount(live.viewerCount, i18n.resolvedLanguage ?? i18n.language ?? "en")} ${t("playback.viewers")}${uptime ? ` · ${uptime}` : ""}`
    : null;
  const title =
    info?.kind === "live"
      ? info.stream.title
      : info?.kind === "recorded"
        ? info.title
        : target.media?.title;
  const detail =
    info?.kind === "live"
      ? info.stream.categoryName
      : info?.kind === "recorded"
        ? `${info.mediaKind} · ${Math.max(0, Math.floor(info.durationSeconds))}s`
        : info?.kind === "ended"
          ? t("playback.watch.channelNotLive")
          : info?.kind === "unavailable"
            ? info.failure.kind === "cancelled"
              ? t("playback.watch.channelDetailsCancelled")
              : info.failure.detail
            : t("playback.watch.loadingChannelDetails");
  const tags = live ? streamTagLabels(live.language, live.tags) : [];

  return (
    <View style={styles.card} testID="watch-channel-chrome">
      {expanded ? (
        <View style={styles.details} testID="watch-channel-expanded">
          <Pressable
            accessibilityLabel={t("playback.watch.openChannel", { name })}
            accessibilityRole="button"
            disabled={!onOpenChannel}
            onPress={onOpenChannel}
            style={({ pressed }) => [
              styles.avatarHit,
              pressed ? styles.pressed : null,
            ]}
            testID="watch-open-channel"
          >
            <MobileAvatar
              livePlatform={channel?.isLive ? channel.platform : null}
              name={name}
              size={48}
              testID={
                channel?.avatarUrl
                  ? "watch-channel-avatar"
                  : "watch-channel-avatar-placeholder"
              }
              uri={channel?.avatarUrl ?? null}
            />
          </Pressable>
          <View style={styles.copy}>
            <View style={styles.nameRow}>
              <Text
                numberOfLines={1}
                selectable
                style={styles.name}
                testID="watch-target"
              >
                {name}
              </Text>
              {channel?.isVerified ? (
                <MobileVerifiedBadge platform={target.platform} />
              ) : null}
            </View>
            {title ? (
              <Text
                numberOfLines={2}
                selectable
                style={styles.title}
                testID="watch-stream-title"
              >
                {title}
              </Text>
            ) : null}
            {detail ? (
              <Text
                numberOfLines={2}
                selectable
                style={styles.detail}
                testID="watch-info-category"
              >
                {detail}
              </Text>
            ) : null}
            {tags.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tags}
                contentContainerStyle={styles.tagContent}
                testID="watch-info-tags"
              >
                {tags.map((label) => (
                  <MobileTag key={label.toLocaleLowerCase()} label={label} />
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={styles.actionRow} testID="watch-card-actions">
        {!expanded ? (
          <Pressable
            accessibilityLabel={t("playback.watch.openChannel", { name })}
            accessibilityRole="button"
            disabled={!onOpenChannel}
            onPress={onOpenChannel}
            style={({ pressed }) => [
              styles.compactIdentity,
              pressed ? styles.pressed : null,
            ]}
            testID="watch-open-channel"
          >
            <Text
              numberOfLines={1}
              style={styles.compactName}
              testID="watch-target"
            >
              {name}
            </Text>
            {meta ? (
              <Text
                numberOfLines={1}
                style={styles.meta}
                testID="watch-meta-viewers"
              >
                {meta}
              </Text>
            ) : (
              <MobilePlatformBadge platform={target.platform} />
            )}
          </Pressable>
        ) : null}
        {onFollow ? (
          <Pressable
            accessibilityLabel={followed ? "Unfollow" : "Follow"}
            accessibilityRole="button"
            accessibilityState={{ busy: followBusy, selected: followed }}
            disabled={followBusy}
            hitSlop={4}
            onPress={onFollow}
            style={({ pressed }) => [
              styles.action,
              styles.follow,
              target.platform === "kick" && !followed
                ? styles.kickFollow
                : null,
              followed ? styles.followed : null,
              expanded ? styles.expandedAction : null,
              pressed ? styles.pressed : null,
              followBusy ? styles.busy : null,
            ]}
            testID="watch-follow"
          >
            <Heart
              color={
                target.platform === "kick" && !followed
                  ? mobileColors.background
                  : mobileColors.textPrimary
              }
              fill={followed ? mobileColors.textPrimary : "transparent"}
              size={18}
            />
            <Text
              style={[
                styles.actionLabel,
                target.platform === "kick" && !followed
                  ? styles.kickLabel
                  : null,
              ]}
            >
              {followed ? "Following" : t("discovery.following.follow")}
            </Text>
          </Pressable>
        ) : null}
        {onToggleLiveAlerts ? (
          <Pressable
            accessibilityLabel={
              liveAlerts ? "Turn off live alerts" : "Turn on live alerts"
            }
            accessibilityRole="button"
            accessibilityState={{
              selected: liveAlerts,
              busy: notificationsBusy,
            }}
            disabled={notificationsBusy}
            hitSlop={4}
            onPress={onToggleLiveAlerts}
            style={({ pressed }) => [
              styles.action,
              styles.notifications,
              expanded ? styles.expandedAction : null,
              pressed ? styles.pressed : null,
              notificationsBusy ? styles.busy : null,
            ]}
            testID="watch-live-alerts"
          >
            {liveAlerts ? (
              <Bell color={mobileColors.textPrimary} size={18} />
            ) : (
              <BellOff color={mobileColors.textSecondary} size={18} />
            )}
            <Text style={styles.actionLabel}>
              {expanded ? "Notifications" : "Notify"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {notificationStatus ? (
        <Text
          accessibilityRole="alert"
          style={styles.status}
          testID="watch-live-alerts-status"
        >
          {notificationStatus}
        </Text>
      ) : null}
    </View>
  );
}

export function streamTagLabels(
  language: string | undefined,
  tags: readonly string[],
): readonly string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const label = value.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };
  if (language)
    add(isBroadcastLanguage(language) ? languageLabel(language) : language);
  tags.forEach(add);
  return labels;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileColors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  details: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 4,
  },
  avatarHit: { width: 48, height: 48 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { ...mobileType.title, fontSize: 18, lineHeight: 22, flexShrink: 1 },
  title: {
    ...mobileType.body,
    color: mobileColors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
  },
  detail: {
    ...mobileType.body,
    color: mobileColors.textCategory,
    fontSize: 14,
    lineHeight: 19,
  },
  tags: { marginTop: 4, flexGrow: 0 },
  tagContent: { flexDirection: "row", gap: 4 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    marginTop: 4,
  },
  compactIdentity: { flex: 1, minWidth: 0, justifyContent: "center" },
  compactName: { ...mobileType.title, fontSize: 14 },
  meta: { ...mobileType.caption, color: mobileColors.textSecondary },
  action: {
    height: 40,
    borderRadius: mobileRadii.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: mobileSpacing.medium,
  },
  expandedAction: { flex: 1, width: 0 },
  follow: { backgroundColor: mobileColors.twitch },
  kickFollow: { backgroundColor: mobileColors.kick },
  followed: { backgroundColor: mobileColors.surfaceMuted },
  notifications: { backgroundColor: mobileColors.surfaceRaised },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  kickLabel: { color: mobileColors.background },
  pressed: { opacity: mobilePressedOpacity },
  busy: { opacity: 0.6 },
  status: {
    ...mobileType.label,
    color: mobileColors.textPrimary,
    paddingVertical: 4,
  },
});
