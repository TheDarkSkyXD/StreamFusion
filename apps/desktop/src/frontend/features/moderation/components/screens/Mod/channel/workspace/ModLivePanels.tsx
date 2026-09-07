import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { useChannelByUsername } from "@/features/discovery/components/hooks/queries/useChannels";
import { useStreamByChannel } from "@/features/discovery/components/hooks/queries/useStreams";
import { useStreamPlayback } from "@/features/playback/components/hooks/useStreamPlayback";

const ChatPanel = lazy(() =>
  import("@/features/chat/components/chat/ChatPanel").then((module) => ({
    default: module.ChatPanel,
  }))
);
const KickLivePlayer = lazy(() =>
  import("@/features/playback/components/player/kick/kick-live-player").then((module) => ({
    default: module.KickLivePlayer,
  }))
);
const TwitchLivePlayer = lazy(() =>
  import("@/features/playback/components/player/twitch/twitch-live-player").then((module) => ({
    default: module.TwitchLivePlayer,
  }))
);

export interface ModLivePanelProps {
  platform: "twitch" | "kick";
  channel: string;
  channelId: string;
}

function PanelState({ children }: { children: string }) {
  return (
    <div
      className="flex h-full min-h-0 items-center justify-center bg-black px-3 text-center text-xs text-[#adadb8]"
      role="status"
    >
      {children}
    </div>
  );
}

export function ModVideoPanel({ platform, channel }: ModLivePanelProps) {
  const { t } = useTranslation();
  const streamQuery = useStreamByChannel(channel, platform);
  const stream = streamQuery.data;
  const isLive = stream?.isLive === true;
  const playback = useStreamPlayback(platform, isLive ? channel : "");

  if (streamQuery.isLoading || (isLive && playback.isLoading)) {
    return <PanelState>{t("moderation.loading")}</PanelState>;
  }

  if (streamQuery.isError || playback.error) {
    return <PanelState>{t("playback.unableToLoadStream")}</PanelState>;
  }

  if (!isLive || !playback.playback?.url) {
    return (
      <PanelState>{t("playback.offline", { defaultValue: "This channel is offline." })}</PanelState>
    );
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-black">
      <Suspense fallback={<PanelState>{t("moderation.loading")}</PanelState>}>
        {platform === "twitch" ? (
          <TwitchLivePlayer
            streamUrl={playback.playback.url}
            channelName={channel}
            poster={stream.thumbnailUrl}
            autoPlay
            muted
            compact
            className="h-full w-full"
          />
        ) : (
          <KickLivePlayer
            streamUrl={playback.playback.url}
            channelName={channel}
            title={stream.title}
            thumbnail={stream.thumbnailUrl}
            startedAt={stream.startedAt}
            autoPlay
            muted
            compact
            className="h-full w-full"
          />
        )}
      </Suspense>
    </div>
  );
}

export function ModChatPanel({ platform, channel, channelId }: ModLivePanelProps) {
  return platform === "twitch" ? (
    <TwitchModChatPanel channel={channel} channelId={channelId} />
  ) : (
    <KickModChatPanel channel={channel} />
  );
}

function TwitchModChatPanel({
  channel,
  channelId,
}: Pick<ModLivePanelProps, "channel" | "channelId">) {
  const { t } = useTranslation();
  return (
    <div className="h-full min-h-0 bg-[#18181b]">
      <Suspense fallback={<PanelState>{t("chat.loadingChat")}</PanelState>}>
        <ChatPanel
          initialPlatform="twitch"
          initialChannel={channel}
          channelId={channelId}
          presentation="workspace"
        />
      </Suspense>
    </div>
  );
}

function KickModChatPanel({ channel }: Pick<ModLivePanelProps, "channel">) {
  const { t } = useTranslation();
  const channelQuery = useChannelByUsername(channel, "kick");
  const channelData = channelQuery.data;
  if (channelQuery.isLoading) {
    return <PanelState>{t("chat.loadingChat")}</PanelState>;
  }

  if (channelQuery.isError || !channelData?.id) {
    return <PanelState>{t("chat.chatroomNotLoaded")}</PanelState>;
  }

  if (!channelData.kickChannelId || !channelData.kickUserId || !channelData.chatroomId) {
    return <PanelState>{t("chat.chatroomNotLoaded")}</PanelState>;
  }

  return (
    <div className="h-full min-h-0 bg-[#18181b]">
      <Suspense fallback={<PanelState>{t("chat.loadingChat")}</PanelState>}>
        <ChatPanel
          initialPlatform="kick"
          initialChannel={channel}
          channelId={channelData.id}
          kickChannelId={channelData.kickChannelId}
          chatroomId={channelData.chatroomId}
          kickUserId={channelData.kickUserId}
          isPartnerChannel={channelData.isPartner}
          presentation="workspace"
        />
      </Suspense>
    </div>
  );
}
