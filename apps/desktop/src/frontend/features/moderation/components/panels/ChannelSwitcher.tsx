import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import type { WorkspaceChannel } from "../../capabilities/workspace-panels";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";

export function ChannelSwitcher({
  currentChannelId,
  refreshCounter = 0,
}: {
  currentChannelId: string;
  refreshCounter?: number;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.twitchUser);
  const [view, setView] = useState<{
    loading: boolean;
    moderated: WorkspaceChannel[];
    followed: WorkspaceChannel[];
    moderatedError: boolean;
    followedError: boolean;
  }>({ loading: true, moderated: [], followed: [], moderatedError: false, followedError: false });
  useEffect(() => {
    let cancelled = false;
    setView({
      loading: !!user,
      moderated: [],
      followed: [],
      moderatedError: false,
      followedError: false,
    });
    if (!user) return;
    const port = getWorkspacePanelsPort();
    void Promise.allSettled([port.moderatedChannels(user.id), port.followedChannels()]).then(
      ([moderated, followed]) => {
        if (cancelled) return;
        setView({
          loading: false,
          moderated: moderated.status === "fulfilled" ? moderated.value : [],
          followed: followed.status === "fulfilled" ? followed.value : [],
          moderatedError: moderated.status === "rejected",
          followedError: followed.status === "rejected",
        });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [user, refreshCounter]);
  const moderated = user
    ? [
        { id: user.id, login: user.login, displayName: user.displayName },
        ...view.moderated.filter((c) => c.id !== user.id),
      ]
    : [];
  return (
    <nav
      aria-label={t("moderation.workspacePanels.channels")}
      className="h-full overflow-y-auto bg-[#18181b] p-3 text-xs text-[#adadb8]"
    >
      {!user && <p>{t("moderation.workspacePanels.signIn")}</p>}
      {view.loading && <p role="status">{t("moderation.workspacePanels.loading")}</p>}
      <h3 className="py-2 font-semibold text-[#efeff1]">
        {t("moderation.workspacePanels.moderated")}
      </h3>
      {view.moderatedError && <p role="alert">{t("moderation.workspacePanels.channelError")}</p>}
      <ul>
        {moderated.slice(0, 100).map((channel) => (
          <li key={channel.id}>
            <Link
              to="/mod/twitch/$channel"
              params={{ channel: channel.login }}
              aria-current={channel.id === currentChannelId ? "page" : undefined}
              className="block rounded px-2 py-2 text-[#bf94ff] hover:bg-[#35353b] aria-[current=page]:bg-[#35353b]"
            >
              {channel.displayName}
            </Link>
          </li>
        ))}
      </ul>
      <h3 className="py-2 font-semibold text-[#efeff1]">
        {t("moderation.workspacePanels.followed")}
      </h3>
      {view.followedError && <p role="alert">{t("moderation.workspacePanels.channelError")}</p>}
      {!view.loading && !view.followedError && !view.followed.length && (
        <p>{t("moderation.workspacePanels.noFollowed")}</p>
      )}
      <ul>
        {view.followed.slice(0, 100).map((channel) => (
          <li key={channel.id}>
            <Link
              to="/stream/$platform/$channel"
              params={{ platform: "twitch", channel: channel.login }}
              className="flex items-center justify-between gap-2 rounded px-2 py-2 hover:bg-[#35353b]"
            >
              <span className="truncate text-[#efeff1]">{channel.displayName}</span>{" "}
              {channel.isLive !== undefined && (
                <span className={channel.isLive ? "text-[#eb0400]" : "text-[#adadb8]"}>
                  {t(`moderation.workspacePanels.${channel.isLive ? "live" : "offline"}`)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {(moderated.length > 100 || view.followed.length > 100) && (
        <p>{t("moderation.workspacePanels.channelLimit")}</p>
      )}
    </nav>
  );
}
