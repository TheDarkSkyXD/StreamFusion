import { useEffect, useMemo, useState } from "react";
import { getChannelToolAccess } from "../../../../../composition/channel-tool-access";
import { ToolAccessGate } from "./ToolAccessGate";
import { ChannelToolsPanel } from "./ChannelToolsPanel";
import { NativeToolsPanel } from "./NativeToolsPanel";
import { ActivityFeedPanel } from "../../../../panels/ActivityFeedPanel";
import { SuspiciousActivityPanel } from "../../../../panels/SuspiciousActivityPanel";
import { CommunityPanel } from "../../../../panels/CommunityPanel";
import { WhispersPanel } from "../../../../panels/WhispersPanel";
import { RewardRequestsPanel } from "../../../../panels/RewardRequestsPanel";
import { ChannelSwitcher } from "../../../../panels/ChannelSwitcher";
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
import { useAuthStore } from "@/features/auth/components/state/auth-store";
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
  grantedScopes?: readonly string[];
  requestScopes?: (scopes: string[]) => void;
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
  grantedScopes = [],
  requestScopes = () => {},
}: ChannelWorkspaceProps) {
  const { t } = useTranslation();
  const accountId = useAuthStore((state) =>
    platform === "twitch" ? state.twitchUser?.id : state.kickUser?.id
  );
  const storageKey = `streamfusion:mod-layout:v1:${platform}:${accountId ?? "local"}:${channelId}`;
  const [verifiedContext, setVerifiedContext] = useState<string | null>(null);
  useEffect(() => {
    if (hasModerationAuthority) setVerifiedContext(storageKey);
  }, [hasModerationAuthority, storageKey]);
  const preserveToolSlots = hasModerationAuthority || verifiedContext === storageKey;
  const widgets = useMemo(() => {
    const access = getChannelToolAccess(grantedScopes, isOwnBroadcaster);
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
    const publicWidgetIds = new Set(available.map((widget) => widget.id));
    if (preserveToolSlots && platform === "twitch")
      available.push(
        {
          id: "unban-requests",
          title: t("moderation.pendingUnbanRequests"),
          icon: <Inbox size={20} />,
          content: (
            <ToolAccessGate access={access.unban} channel={channel} requestScopes={requestScopes}>
              <ChannelUnbanRequests
                broadcasterId={channelId}
                refreshCounter={refreshCounter}
                canManage={access.unban.canManage}
              />
            </ToolAccessGate>
          ),
        },
        {
          id: "banned-users",
          title: t("moderation.bannedUsers"),
          icon: <Ban size={20} />,
          content: (
            <ToolAccessGate access={access.bans} channel={channel} requestScopes={requestScopes}>
              <ChannelBannedList
                platform={platform}
                broadcasterId={channelId}
                refreshCounter={refreshCounter}
                canManage={access.bans.canManage}
              />
            </ToolAccessGate>
          ),
        }
      );
    if (platform === "twitch" && preserveToolSlots && isOwnBroadcaster)
      available.push(
        {
          id: "moderators",
          title: t("moderation.moderators"),
          icon: <Users size={20} />,
          content: (
            <ToolAccessGate
              access={access.moderators}
              channel={channel}
              requestScopes={requestScopes}
            >
              <ChannelModeratorsTable
                broadcasterId={channelId}
                refreshCounter={refreshCounter}
                canManage={access.moderators.canManage}
              />
            </ToolAccessGate>
          ),
        },
        {
          id: "vips",
          title: t("moderation.vips"),
          icon: <Gem size={20} />,
          content: (
            <ToolAccessGate access={access.vips} channel={channel} requestScopes={requestScopes}>
              <ChannelVipsTable
                broadcasterId={channelId}
                refreshCounter={refreshCounter}
                canManage={access.vips.canManage}
              />
            </ToolAccessGate>
          ),
        }
      );
    if (platform === "twitch" && preserveToolSlots)
      available.push(
        {
          id: "engagement",
          title: t("moderation.activeEngagement"),
          icon: <ChartColumn size={20} />,
          content: (
            <ChannelEngagement
              broadcasterId={channelId}
              refreshCounter={refreshCounter}
              channel={channel}
              access={access}
              requestScopes={requestScopes}
            />
          ),
        },
        {
          id: "channel-tools",
          title: t("moderation.tools.channelTools"),
          icon: <Shield size={20} />,
          content: (
            <ChannelToolsPanel
              channelId={channelId}
              channel={channel}
              actorId={String(accountId ?? "")}
              refreshCounter={refreshCounter}
              access={access}
              requestScopes={requestScopes}
            />
          ),
        },
        {
          id: "activity",
          title: t("moderation.workspacePanels.activity"),
          icon: <ChartColumn size={20} />,
          content: (
            <ActivityFeedPanel
              channelId={channelId}
              channelName={channel}
              refreshCounter={refreshCounter}
            />
          ),
        },
        {
          id: "suspicious",
          title: t("moderation.workspacePanels.suspicious"),
          icon: <Shield size={20} />,
          content: (
            <SuspiciousActivityPanel
              channelId={channelId}
              channelName={channel}
              refreshCounter={refreshCounter}
            />
          ),
        },
        {
          id: "community",
          title: t("moderation.workspacePanels.community"),
          icon: <Users size={20} />,
          content: (
            <CommunityPanel
              channelId={channelId}
              channelName={channel}
              refreshCounter={refreshCounter}
            />
          ),
        },
        {
          id: "whispers",
          title: t("moderation.workspacePanels.whispers"),
          icon: <MessageSquare size={20} />,
          content: (
            <WhispersPanel
              channelId={channelId}
              channelName={channel}
              refreshCounter={refreshCounter}
            />
          ),
        },
        {
          id: "rewards",
          title: t("moderation.workspacePanels.rewards"),
          icon: <Gem size={20} />,
          content: (
            <RewardRequestsPanel
              channelId={channelId}
              channelName={channel}
              refreshCounter={refreshCounter}
            />
          ),
        },
        {
          id: "channels",
          title: t("moderation.workspacePanels.channels"),
          icon: <Video size={20} />,
          content: <ChannelSwitcher currentChannelId={channelId} refreshCounter={refreshCounter} />,
        },
        {
          id: "native-tools",
          title: t("moderation.tools.native.title"),
          icon: <Inbox size={20} />,
          content: <NativeToolsPanel channel={channel} />,
        }
      );
    return hasModerationAuthority
      ? available
      : available.map((widget) =>
          publicWidgetIds.has(widget.id)
            ? widget
            : {
                ...widget,
                content: (
                  <p role="status" className="p-3 text-sm text-[var(--color-foreground-muted)]">
                    {t("moderation.accessUnconfirmed")}
                  </p>
                ),
              }
        );
  }, [
    t,
    platform,
    channel,
    channelId,
    displayName,
    retentionScope,
    isOwnBroadcaster,
    hasModerationAuthority,
    preserveToolSlots,
    refreshCounter,
    grantedScopes,
    requestScopes,
    accountId,
  ]);
  return (
    <ModWorkspace key={storageKey} storageKey={storageKey} platform={platform} widgets={widgets} />
  );
}
