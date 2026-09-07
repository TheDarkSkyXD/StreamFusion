import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";
import { NativeModView, PanelFeedback, panelButton } from "./PanelFeedback";
import { useWorkspaceFeed, type WorkspacePanelProps } from "./useWorkspaceFeed";
import { usePanelRead } from "./usePanelRead";
import { PanelDecision, usePanelManagementAccess } from "./PanelDecision";
const REWARD_SCOPES = [["channel:read:redemptions", "channel:manage:redemptions"]];
function RedemptionPage({
  channelId,
  actorId,
  rewardId,
  refreshCounter,
}: {
  channelId: string;
  actorId: string;
  rewardId: string;
  refreshCounter: number | string;
}) {
  const { t } = useTranslation();
  const [after, setAfter] = useState<string | undefined>();
  const load = useCallback(
    () => getWorkspacePanelsPort().redemptions(channelId, rewardId, after),
    [channelId, rewardId, after]
  );
  const view = usePanelRead(actorId, refreshCounter, REWARD_SCOPES, load);
  const management = usePanelManagementAccess(actorId, "channel:manage:redemptions");
  return (
    <PanelFeedback
      state={view.state}
      error={view.error}
      scopes={view.missingScopes}
      retry={view.retry}
    >
      {view.data?.items.length === 0 && (
        <p className="py-3">{t("moderation.workspacePanels.noRedemptions")}</p>
      )}
      {!management.allowed && (
        <button className={panelButton} onClick={management.reconnect}>
          {t("moderation.workspacePanels.grantManage")}
        </button>
      )}
      <ul className="divide-y divide-[#303034]">
        {view.data?.items.slice(0, 100).map((item) => (
          <li key={item.redemptionId} className="space-y-1 py-2">
            <strong className="text-[#efeff1]">{item.user.displayName}</strong>
            <p>
              {t("moderation.workspacePanels.points", { count: item.cost })} ·{" "}
              {t(`moderation.workspacePanels.${item.status}`)}
            </p>
            {item.input && (
              <p className="whitespace-pre-wrap break-words text-[#dedee3]">{item.input}</p>
            )}
            <time dateTime={item.redeemedAt}>{new Date(item.redeemedAt).toLocaleString()}</time>
            {management.allowed && item.status === "unfulfilled" && (
              <PanelDecision
                actions={
                  [
                    { value: "FULFILLED", label: t("moderation.workspacePanels.fulfillReward") },
                    { value: "CANCELED", label: t("moderation.workspacePanels.cancelReward") },
                  ] as const
                }
                apply={(value) =>
                  getWorkspacePanelsPort().decideRedemption(
                    channelId,
                    rewardId,
                    item.redemptionId,
                    value
                  )
                }
                onSuccess={view.retry}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 py-2">
        {after && (
          <button className={panelButton} onClick={() => setAfter(undefined)}>
            {t("moderation.workspacePanels.first")}
          </button>
        )}
        {view.data?.cursor && (
          <button className={panelButton} onClick={() => setAfter(view.data?.cursor ?? undefined)}>
            {t("moderation.workspacePanels.next")}
          </button>
        )}
      </div>
    </PanelFeedback>
  );
}
function OwnedRewards({
  channelId,
  actorId,
  refreshCounter = 0,
}: { actorId: string } & WorkspacePanelProps) {
  const { t } = useTranslation();
  const feed = useWorkspaceFeed("rewards", channelId, refreshCounter);
  const [selected, setSelected] = useState("");
  const load = useCallback(() => getWorkspacePanelsPort().rewards(channelId), [channelId]);
  const view = usePanelRead(actorId, refreshCounter, REWARD_SCOPES, load);
  const rewardId = view.data?.items.some((item) => item.id === selected)
    ? selected
    : view.data?.items[0]?.id;
  const latestRewardEvent =
    feed.events.find((event) => event.kind === "reward" && event.rewardId === rewardId)?.id ?? "";
  return (
    <PanelFeedback
      state={view.state}
      error={view.error}
      scopes={view.missingScopes}
      retry={view.retry}
    >
      {view.data?.items.length === 0 && (
        <p className="py-3">{t("moderation.workspacePanels.noRewards")}</p>
      )}
      <p className="pt-2" role="status">
        {t(`moderation.workspacePanels.${feed.state}`)}
      </p>
      {rewardId && (
        <>
          <label className="my-3 block">
            {t("moderation.workspacePanels.selectReward")}
            <select
              className="mt-1 block w-full rounded border border-[#53535f] bg-[#0e0e10] p-2 text-[#efeff1]"
              value={rewardId}
              onChange={(event) => setSelected(event.target.value)}
            >
              {view.data?.items.map((reward) => (
                <option key={reward.id} value={reward.id}>
                  {reward.title}
                </option>
              ))}
            </select>
          </label>
          <RedemptionPage
            key={rewardId}
            actorId={actorId}
            channelId={channelId}
            rewardId={rewardId}
            refreshCounter={`${refreshCounter}:${latestRewardEvent}`}
          />
        </>
      )}
    </PanelFeedback>
  );
}
export function RewardRequestsPanel(props: WorkspacePanelProps) {
  const { t } = useTranslation();
  const actorId = useAuthStore((s) => s.twitchUser?.id);
  return (
    <section
      aria-label={t("moderation.workspacePanels.rewards")}
      className="h-full overflow-y-auto bg-[#18181b] p-3 text-xs text-[#adadb8]"
    >
      <p className="pb-3">{t("moderation.workspacePanels.rewardCoverage")}</p>
      <NativeModView channelName={props.channelName} />
      {actorId === props.channelId ? (
        <OwnedRewards key={`${actorId}:${props.channelId}`} {...props} actorId={actorId} />
      ) : (
        <p className="py-3">{t("moderation.workspacePanels.broadcasterOnly")}</p>
      )}
    </section>
  );
}
