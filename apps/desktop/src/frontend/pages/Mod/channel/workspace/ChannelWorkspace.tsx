import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Video,
  MessageSquare,
  Shield,
  Clock,
  Ban,
  Inbox,
  Users,
  Gem,
  ChartColumn,
} from "lucide-react";
import type { RetentionScope } from "@shared/mod-log-types";
import { useAuthStore } from "@/store/auth-store";
import { ChannelBannedList } from "../ChannelBannedList";
import { ChannelEngagement } from "../ChannelEngagement";
import { ChannelModeratorsTable } from "../ChannelModeratorsTable";
import { ChannelModLogFeed } from "../ChannelModLogFeed";
import { ChannelUnbanRequests } from "../ChannelUnbanRequests";
import { ChannelVipsTable } from "../ChannelVipsTable";
import { RetentionCard } from "../RetentionCard";
import { ModChatPanel, ModVideoPanel } from "./ModLivePanels";
import { AutoModQueue } from "./AutoModQueue";
import { ModWorkspace } from "./ModWorkspace";
import type { ModWidget } from "./ModWorkspace";

interface ChannelWorkspaceProps {
  platform: "twitch" | "kick";
  channel: string;
  channelId: string;
  displayName: string;
  retentionScope: RetentionScope;
  isOwnBroadcaster: boolean;
  hasModerationAuthority: boolean;
  refreshCounter: number;
}

export function ChannelWorkspace({
  platform,
  channel,
  channelId,
  displayName,
  retentionScope,
  isOwnBroadcaster,
  hasModerationAuthority,
  refreshCounter,
}: ChannelWorkspaceProps) {
  const { t } = useTranslation();
  const accountId = useAuthStore((state) =>
    platform === "twitch" ? state.twitchUser?.id : state.kickUser?.id
  );
  const widgets = useMemo(() => {
    const available: ModWidget[] = [
      {
        id: "video",
        title: t("moderation.workspace.stream", { defaultValue: "Stream" }),
        icon: <Video size={20} />,
        content: <ModVideoPanel platform={platform} channel={channel} channelId={channelId} />,
      },
      {
        id: "chat",
        title: t("moderation.workspace.chat", { defaultValue: "Chat" }),
        icon: <MessageSquare size={20} />,
        content: <ModChatPanel platform={platform} channel={channel} channelId={channelId} />,
      },
      {
        id: "mod-log",
        title: t("moderation.workspace.modActions", { defaultValue: "Mod Actions" }),
        icon: <Shield size={20} />,
        content: (
          <ChannelModLogFeed
            platform={platform}
            channelId={channelId}
            channelSlug={channel}
            refreshCounter={refreshCounter}
            presentation="embedded"
          />
        ),
      },
      {
        id: "retention",
        title: t("moderation.retention"),
        icon: <Clock size={20} />,
        content: (
          <section data-testid="mod-channel-retention" className="space-y-3">
            <RetentionCard
              scope={retentionScope}
              title={t("moderation.thisChannel", { channel: displayName })}
            />
            <RetentionCard scope="global" title={t("moderation.globalDefault")} />
          </section>
        ),
      },
    ];
    if (platform === "twitch")
      available.push({
        id: "automod",
        title: t("moderation.autoMod.queueTitle", { defaultValue: "AutoMod Queue" }),
        icon: <Shield size={20} />,
        content: <AutoModQueue channelId={channelId} channel={channel} />,
      });
    if (hasModerationAuthority && platform === "twitch")
      available.push(
        {
          id: "unban-requests",
          title: t("moderation.pendingUnbanRequests"),
          icon: <Inbox size={20} />,
          content: (
            <ChannelUnbanRequests broadcasterId={channelId} refreshCounter={refreshCounter} />
          ),
        },
        {
          id: "banned-users",
          title: t("moderation.bannedUsers"),
          icon: <Ban size={20} />,
          content: (
            <ChannelBannedList
              platform={platform}
              broadcasterId={channelId}
              refreshCounter={refreshCounter}
            />
          ),
        }
      );
    if (platform === "twitch" && hasModerationAuthority && isOwnBroadcaster)
      available.push(
        {
          id: "moderators",
          title: t("moderation.moderators"),
          icon: <Users size={20} />,
          content: (
            <ChannelModeratorsTable broadcasterId={channelId} refreshCounter={refreshCounter} />
          ),
        },
        {
          id: "vips",
          title: t("moderation.vips"),
          icon: <Gem size={20} />,
          content: <ChannelVipsTable broadcasterId={channelId} refreshCounter={refreshCounter} />,
        },
        {
          id: "engagement",
          title: t("moderation.activeEngagement"),
          icon: <ChartColumn size={20} />,
          content: <ChannelEngagement broadcasterId={channelId} refreshCounter={refreshCounter} />,
        }
      );
    return available;
  }, [
    t,
    platform,
    channel,
    channelId,
    displayName,
    retentionScope,
    isOwnBroadcaster,
    hasModerationAuthority,
    refreshCounter,
  ]);
  const storageKey = `streamfusion:mod-layout:v1:${platform}:${accountId ?? "local"}:${channelId}`;
  return (
    <ModWorkspace
      key={`${storageKey}:${isOwnBroadcaster}:${hasModerationAuthority}`}
      storageKey={storageKey}
      platform={platform}
      widgets={widgets}
    />
  );
}
