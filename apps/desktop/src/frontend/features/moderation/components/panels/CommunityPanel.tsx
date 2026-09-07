import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";
import { NativeModView, PanelFeedback, panelButton } from "./PanelFeedback";
import type { WorkspacePanelProps } from "./useWorkspaceFeed";
import { usePanelRead } from "./usePanelRead";
const CHATTER_SCOPES = [["moderator:read:chatters"]];
const MOD_SCOPES = [["moderator:read:chatters"], ["moderation:read", "channel:manage:moderators"]];

function CommunityPage({
  channelId,
  actorId,
  mods,
  refreshCounter = 0,
}: { actorId: string | undefined; mods: boolean } & WorkspacePanelProps) {
  const { t } = useTranslation();
  const [after, setAfter] = useState<string | undefined>();
  const load = useCallback(
    () =>
      mods
        ? getWorkspacePanelsPort().activeModerators(channelId, actorId ?? "", after)
        : getWorkspacePanelsPort().chatters(channelId, actorId ?? "", after),
    [mods, channelId, actorId, after]
  );
  const view = usePanelRead(actorId, refreshCounter, mods ? MOD_SCOPES : CHATTER_SCOPES, load);
  return (
    <>
      <p className="py-2">
        {t(`moderation.workspacePanels.${mods ? "modsCoverage" : "chatterCoverage"}`)}
      </p>
      <PanelFeedback
        state={view.state}
        error={view.error}
        scopes={view.missingScopes}
        retry={view.retry}
      >
        {view.data && (
          <>
            <p>
              {t("moderation.workspacePanels.observed", {
                time: new Date(view.data.observedAt).toLocaleString(),
              })}
            </p>
            {"rosterComplete" in view.data && !view.data.rosterComplete && (
              <p>{t("moderation.workspacePanels.rosterIncomplete")}</p>
            )}
            {view.data.items.length === 0 && (
              <p className="py-3">{t("moderation.workspacePanels.emptyCommunity")}</p>
            )}
            <ul className="divide-y divide-[#303034]">
              {view.data.items.slice(0, 100).map((user) => (
                <li key={user.id} className="py-2 text-[#efeff1]">
                  {user.displayName}
                  <span className="ml-2 text-[#adadb8]">@{user.login}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 py-2">
              {after && (
                <button className={panelButton} onClick={() => setAfter(undefined)}>
                  {t("moderation.workspacePanels.first")}
                </button>
              )}
              {view.data.cursor && (
                <button
                  className={panelButton}
                  onClick={() => setAfter(view.data?.cursor ?? undefined)}
                >
                  {t("moderation.workspacePanels.next")}
                </button>
              )}
            </div>
          </>
        )}
      </PanelFeedback>
    </>
  );
}
export function CommunityPanel(props: WorkspacePanelProps) {
  const { t } = useTranslation();
  const actorId = useAuthStore((s) => s.twitchUser?.id);
  const [mods, setMods] = useState(false);
  return (
    <section
      aria-label={t("moderation.workspacePanels.community")}
      className="h-full overflow-y-auto bg-[#18181b] p-3 text-xs text-[#adadb8]"
    >
      <div
        className="flex gap-2"
        role="group"
        aria-label={t("moderation.workspacePanels.community")}
      >
        <button aria-pressed={!mods} className={panelButton} onClick={() => setMods(false)}>
          {t("moderation.workspacePanels.chatters")}
        </button>
        <button aria-pressed={mods} className={panelButton} onClick={() => setMods(true)}>
          {t("moderation.workspacePanels.activeMods")}
        </button>
      </div>
      {mods && actorId !== props.channelId ? (
        <p className="py-3">{t("moderation.workspacePanels.broadcasterOnly")}</p>
      ) : (
        <CommunityPage
          key={`${props.channelId}:${actorId}:${mods}`}
          {...props}
          actorId={actorId}
          mods={mods}
        />
      )}
      <NativeModView channelName={props.channelName} />
    </section>
  );
}
