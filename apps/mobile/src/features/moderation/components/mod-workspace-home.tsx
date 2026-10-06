import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Ban,
  ChartColumn,
  Clock,
  Gem,
  Inbox,
  MessageSquare,
  MoreHorizontal,
  Shield,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react-native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileButton } from "@mobile/design/button";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileListRow } from "@mobile/design/list-row";
import { MobileSelect } from "@mobile/design/select";
import { mobileColors, mobileSpacing, mobileType } from "@mobile/design/tokens";
import type { ModerationChannel } from "../capabilities/moderation";
import type { ModerationSnapshot } from "../domain/moderation-controller";
import { PersonInitial } from "./provider-tool-sheet";

export type WorkspaceTool =
  | "chat"
  | "actions"
  | "settings"
  | "automod"
  | "banned"
  | "unban-requests"
  | "moderators"
  | "vips"
  | "stream"
  | "logs"
  | "retention"
  | "activity"
  | "community"
  | "rewards"
  | "suspicious"
  | "whispers"
  | "provider"
  | "engagement";
const tools: readonly {
  readonly id: WorkspaceTool;
  readonly title: string;
  readonly description: string;
}[] = [
  {
    id: "chat",
    title: "Live chat",
    description: "Watch channel chat and select message actions",
  },
  {
    id: "automod",
    title: "AutoMod queue",
    description: "Held Twitch messages since connection",
  },
  {
    id: "retention",
    title: "Retention",
    description: "Keep local moderation history in days",
  },
  {
    id: "logs",
    title: "Mod actions",
    description: "Search locally issued and observed actions",
  },
  { id: "banned", title: "Banned users", description: "Review channel bans" },
  {
    id: "unban-requests",
    title: "Unban requests",
    description: "Review pending Twitch appeals",
  },
  {
    id: "moderators",
    title: "Moderators",
    description: "Channel moderation roles",
  },
  { id: "vips", title: "VIPs", description: "Community roles" },
  {
    id: "stream",
    title: "Stream tools",
    description: "Stream info, protection, blocked terms, and raid",
  },
  {
    id: "settings",
    title: "Chat modes",
    description: "Slow, follower, subscriber, emote, and unique chat",
  },
  {
    id: "activity",
    title: "Channel activity",
    description: "Events observed since connection",
  },
  {
    id: "community",
    title: "Community",
    description: "Current Twitch chatters",
  },
  {
    id: "rewards",
    title: "Rewards",
    description: "Requests for app-created Twitch rewards",
  },
  {
    id: "suspicious",
    title: "Suspicious activity",
    description: "Live flagged chatter observations",
  },
  {
    id: "whispers",
    title: "Whispers",
    description: "Connected Twitch account conversations",
  },
  {
    id: "actions",
    title: "User and message actions",
    description: "Timeout, ban, unban, and delete",
  },
  {
    id: "engagement",
    title: "Polls and predictions",
    description: "Broadcaster management and viewer handoff",
  },
  {
    id: "provider",
    title: "Platform tools",
    description: "Open provider-owned controls",
  },
];
const toolVocabulary: Readonly<
  Partial<
    Record<
      WorkspaceTool,
      {
        readonly key: string;
        readonly title: string;
        readonly icon: LucideIcon;
      }
    >
  >
> = {
  chat: {
    key: "moderation.workspace.chat",
    title: "Chat",
    icon: MessageSquare,
  },
  automod: {
    key: "moderation.autoMod.queueTitle",
    title: "AutoMod Queue",
    icon: Shield,
  },
  logs: {
    key: "moderation.workspace.modActions",
    title: "Mod Actions",
    icon: Shield,
  },
  retention: { key: "moderation.retention", title: "Retention", icon: Clock },
  banned: { key: "moderation.bannedUsers", title: "Banned users", icon: Ban },
  "unban-requests": {
    key: "moderation.pendingUnbanRequests",
    title: "Pending unban requests",
    icon: Inbox,
  },
  moderators: {
    key: "moderation.moderators",
    title: "Moderators",
    icon: Users,
  },
  vips: { key: "moderation.vips", title: "VIPs", icon: Gem },
  stream: {
    key: "moderation.tools.channelTools",
    title: "Channel tools",
    icon: Shield,
  },
  activity: {
    key: "moderation.workspacePanels.activity",
    title: "Activity Feed",
    icon: ChartColumn,
  },
  community: {
    key: "moderation.workspacePanels.community",
    title: "Community",
    icon: Users,
  },
  rewards: {
    key: "moderation.workspacePanels.rewards",
    title: "Reward Requests",
    icon: Gem,
  },
  suspicious: {
    key: "moderation.workspacePanels.suspicious",
    title: "Suspicious Activity",
    icon: Shield,
  },
  whispers: {
    key: "moderation.workspacePanels.whispers",
    title: "Whispers",
    icon: MessageSquare,
  },
  engagement: {
    key: "moderation.activeEngagement",
    title: "Active engagement",
    icon: ChartColumn,
  },
  provider: {
    key: "moderation.tools.native.title",
    title: "More Twitch tools",
    icon: Video,
  },
};
export function ModWorkspaceHome({
  snapshot,
  feedback,
  onLoadPlatform,
  onSelectChannel,
  onOpenTool,
}: {
  readonly snapshot: ModerationSnapshot;
  readonly feedback: ReactNode;
  readonly onLoadPlatform: (platform: Platform) => void;
  readonly onSelectChannel: (channel: ModerationChannel) => void;
  readonly onOpenTool: (tool: WorkspaceTool) => void;
}) {
  const { t } = useTranslation();
  const selection = snapshot.selection;
  const pending = snapshot.activity.kind === "pending";
  const visible = tools.filter((tool) =>
    snapshot.platform === "twitch"
      ? tool.id !== "retention"
      : !["automod", "vips", "whispers", "rewards"].includes(tool.id),
  );
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      {!selection ? (
        <View style={styles.row}>
          {(["twitch", "kick"] as const).map((platform) => (
            <MobileFilterChip
              key={platform}
              accessibilityLabel={`Load ${platform} moderated channels`}
              label={platform === "twitch" ? "Twitch" : "Kick"}
              selected={snapshot.platform === platform}
              onPress={() => onLoadPlatform(platform)}
              testID={`mod-${platform}`}
            />
          ))}
        </View>
      ) : null}
      {snapshot.channels.length ? (
        <MobileSelect
          accessibilityLabel="Channel workspace"
          testID="mod-channel"
          value={
            selection
              ? `${selection.channel.platform}:${selection.channel.id}`
              : "Choose a channel"
          }
          options={snapshot.channels.map((channel) => ({
            value: `${channel.platform}:${channel.id}`,
            label: `${channel.name} · ${channel.platform === "twitch" ? "Twitch" : "Kick"}`,
          }))}
          onChange={(id) => {
            const channel = snapshot.channels.find(
              (item) => `${item.platform}:${item.id}` === id,
            );
            if (channel) onSelectChannel(channel);
          }}
          disabled={pending}
        />
      ) : null}
      {snapshot.activity.kind === "success" ? null : feedback}
      {!selection ? (
        <View style={styles.card}>
          <Text style={mobileType.title}>Choose a channel workspace</Text>
          <Text style={mobileType.body}>
            Connect an account and select a channel. Your role is verified
            before each provider action.
          </Text>
          {!pending &&
          snapshot.activity.kind !== "failure" &&
          snapshot.channels.length === 0 ? (
            <Text style={mobileType.label}>
              No channel results loaded for this provider.
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.row}>
            <PersonInitial name={selection.channel.name} />
            <View style={styles.copy}>
              <Text style={mobileType.title}>{selection.channel.name}</Text>
              <Text style={mobileType.label}>
                Verified {selection.role} ·{" "}
                {snapshot.platform === "twitch" ? "Twitch" : "Kick"}
              </Text>
            </View>
            <ProviderSwitcher
              platform={snapshot.platform}
              onLoadPlatform={onLoadPlatform}
            />
          </View>
          <Text style={mobileType.body}>
            Focus on one task at a time. Keep the channel context while moving
            between tools.
          </Text>
        </View>
      )}
      {!selection ? (
        <MobileButton
          accessibilityLabel="Refresh moderated channels"
          disabled={pending}
          variant="outline"
          onPress={() => onLoadPlatform(snapshot.platform)}
          testID="mod-refresh"
        >
          Refresh channels
        </MobileButton>
      ) : null}
      {snapshot.platform === "kick" ? (
        <Text style={mobileType.label}>
          Kick&apos;s official API verifies only your broadcaster channel.
          Unsupported tools open the Kick channel with their limitations.
        </Text>
      ) : null}
      {selection ? (
        <>
          <Text style={mobileType.title}>Channel tools</Text>
          <View style={styles.tools}>
            {visible.map((tool) => {
              const vocabulary = toolVocabulary[tool.id];
              const Icon = vocabulary?.icon ?? Shield;
              return (
                <MobileListRow
                  key={tool.id}
                  title={
                    snapshot.platform === "kick" && tool.id === "provider"
                      ? "More Kick tools"
                      : vocabulary
                        ? t(vocabulary.key, { defaultValue: vocabulary.title })
                        : tool.title
                  }
                  leading={
                    <Icon size={20} color={mobileColors.textSecondary} />
                  }
                  description={tool.description}
                  onPress={() => onOpenTool(tool.id)}
                  testID={`mod-tool-${tool.id}`}
                />
              );
            })}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
function ProviderSwitcher({
  platform,
  onLoadPlatform,
}: {
  readonly platform: Platform;
  readonly onLoadPlatform: (platform: Platform) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MobileIconButton
        label="Change moderation provider or refresh channels"
        onPress={() => setOpen(true)}
        testID="mod-provider-picker"
      >
        <MoreHorizontal size={20} color={mobileColors.textSecondary} />
      </MobileIconButton>
      <MobileBottomSheet
        visible={open}
        title="Channel provider"
        onDismiss={() => setOpen(false)}
      >
        {(["twitch", "kick"] as const).map((provider) => (
          <MobileListRow
            key={provider}
            title={
              provider === "twitch"
                ? "Twitch channels"
                : "Kick broadcaster channel"
            }
            description={
              provider === platform
                ? "Current provider. Refresh channels."
                : "Switch provider and verify your channel role"
            }
            onPress={() => {
              setOpen(false);
              onLoadPlatform(provider);
            }}
          />
        ))}
      </MobileBottomSheet>
    </>
  );
}
const styles = StyleSheet.create({
  page: {
    padding: mobileSpacing.medium,
    gap: mobileSpacing.medium,
    backgroundColor: mobileColors.background,
  },
  row: { flexDirection: "row", alignItems: "center", gap: mobileSpacing.small },
  copy: { flex: 1, gap: mobileSpacing.xSmall },
  card: {
    padding: mobileSpacing.medium,
    gap: mobileSpacing.small,
    borderRadius: 12,
    backgroundColor: mobileColors.surface,
    borderWidth: 1,
    borderColor: mobileColors.border,
  },
  tools: {
    borderRadius: 12,
    backgroundColor: mobileColors.surface,
    borderWidth: 1,
    borderColor: mobileColors.border,
  },
});
