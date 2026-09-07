import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import type { ModerationFeedEvent } from "@shared/moderation-types";
import type { WorkspaceFeedKind } from "../../domain/workspace-feed";
import { useWorkspaceFeed, type WorkspacePanelProps } from "./useWorkspaceFeed";
import { NativeModView, PanelFeedback, panelButton } from "./PanelFeedback";
import { PanelDecision, usePanelManagementAccess } from "./PanelDecision";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";
import { useState } from "react";
import { useReconnectDialogStore } from "@/features/auth/components/state/reconnect-dialog-store";
import { FeedFilterMenu } from "./FeedFilterMenu";

function SuspiciousUserDecision({
  channelId,
  actorId,
  userId,
}: {
  channelId: string;
  actorId: string;
  userId: string;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string | null>(null);
  return (
    <>
      {status && <p role="status">{status}</p>}
      <PanelDecision
        actions={
          [
            { value: "ACTIVE_MONITORING", label: t("moderation.workspacePanels.monitorUser") },
            { value: "RESTRICTED", label: t("moderation.workspacePanels.restrictUser") },
            { value: "NO_TREATMENT", label: t("moderation.workspacePanels.clearMonitoring") },
          ] as const
        }
        apply={(value) =>
          getWorkspacePanelsPort().setSuspiciousStatus(channelId, actorId, userId, value)
        }
        onSuccess={(value) =>
          setStatus(
            t(
              `moderation.workspacePanels.${value === "ACTIVE_MONITORING" ? "monitoring" : value === "RESTRICTED" ? "restricted" : "cleared"}`
            )
          )
        }
      />
    </>
  );
}

const actionKeys = {
  follow: "follow",
  subscribe: "subscribe",
  "subscription-gift": "gift",
  "subscription-message": "subscriptionMessage",
  cheer: "cheer",
  raid: "raid",
} as const;
const eventKeys = {
  "channel.follow": "follow",
  "channel.subscribe": "subscribe",
  "channel.subscription.gift": "gift",
  "channel.subscription.message": "subscriptionMessage",
  "channel.cheer": "cheer",
  "channel.raid": "raid",
} as const;
function FeedRow({
  event,
  canManage,
  actorId,
}: {
  event: ModerationFeedEvent;
  canManage: boolean;
  actorId: string | undefined;
}) {
  const { t } = useTranslation();
  if (event.kind === "reward") return null;
  const label =
    event.kind === "activity"
      ? t(`moderation.workspacePanels.${actionKeys[event.action]}`)
      : event.kind === "whisper"
        ? t("moderation.workspacePanels.whisperFrom", { name: event.from.displayName })
        : t(
            `moderation.workspacePanels.${event.kind === "suspicious-message" ? "suspiciousMessage" : "suspiciousUpdate"}`
          );
  return (
    <li className="border-b border-[#303034] py-2 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <strong className="text-[#efeff1]">{label}</strong>
        <time className="shrink-0 text-[#adadb8]" dateTime={event.occurredAt}>
          {new Date(event.occurredAt).toLocaleTimeString()}
        </time>
      </div>
      {event.kind !== "whisper" && (
        <p className="text-[#bf94ff]">
          {event.user?.displayName ?? t("moderation.workspacePanels.anonymous")}
        </p>
      )}
      {"message" in event && event.message && (
        <p className="whitespace-pre-wrap break-words text-[#dedee3]">{event.message}</p>
      )}
      {event.kind === "activity" && event.count !== null && (
        <p>{t("moderation.workspacePanels.count", { count: event.count })}</p>
      )}
      {"status" in event && (
        <p className="text-[#adadb8]">
          {t(
            `moderation.workspacePanels.${event.status === "restricted" ? "restricted" : event.status === "active_monitoring" ? "monitoring" : event.status === "none" ? "cleared" : "unknownStatus"}`
          )}
        </p>
      )}
      {canManage &&
        actorId &&
        (event.kind === "suspicious-message" || event.kind === "suspicious-update") && (
          <SuspiciousUserDecision
            channelId={event.channelId}
            actorId={actorId}
            userId={event.user.id}
          />
        )}
    </li>
  );
}
export function WorkspaceFeedPanel({
  kind,
  channelId,
  channelName,
  refreshCounter,
}: { kind: WorkspaceFeedKind } & WorkspacePanelProps) {
  const { t } = useTranslation();
  const actorId = useAuthStore((s) => s.twitchUser?.id);
  const feed = useWorkspaceFeed(kind, channelId, refreshCounter);
  const management = usePanelManagementAccess(actorId, "moderator:manage:suspicious_users");
  const filterScope = `${kind}:${channelId}:${actorId}`;
  const [filter, setFilter] = useState<{ scope: string; selected: string[] | null }>({
    scope: filterScope,
    selected: null,
  });
  const selected = filter.scope === filterScope ? filter.selected : null;
  const filterOptions =
    kind === "activity"
      ? feed.subscriptions.flatMap((event) =>
          event in eventKeys
            ? [
                {
                  value: eventKeys[event as keyof typeof eventKeys],
                  label: t(
                    `moderation.workspacePanels.${eventKeys[event as keyof typeof eventKeys]}`
                  ),
                },
              ]
            : []
        )
      : [
          { value: "active_monitoring", label: t("moderation.workspacePanels.monitoring") },
          { value: "restricted", label: t("moderation.workspacePanels.restricted") },
          { value: "none", label: t("moderation.workspacePanels.cleared") },
        ];
  const filteredEvents =
    selected === null
      ? feed.events
      : feed.events.filter((event) =>
          event.kind === "activity"
            ? selected.includes(actionKeys[event.action])
            : (event.kind === "suspicious-message" || event.kind === "suspicious-update") &&
              selected.includes(event.status)
        );
  const activityTypes = feed.subscriptions.flatMap((event) =>
    event in eventKeys
      ? [t(`moderation.workspacePanels.${eventKeys[event as keyof typeof eventKeys]}`)]
      : []
  );
  return (
    <section
      aria-label={t(`moderation.workspacePanels.${kind}`)}
      className="h-full overflow-y-auto bg-[#18181b] p-3 text-xs text-[#adadb8]"
    >
      <div className="space-y-2 border-b border-[#303034] pb-3">
        {(kind === "activity" || kind === "suspicious") && (
          <FeedFilterMenu
            label={t(
              `moderation.workspacePanels.${kind === "activity" ? "activityFilter" : "suspiciousFilter"}`
            )}
            options={filterOptions}
            selected={selected}
            onChange={(values) => setFilter({ scope: filterScope, selected: values })}
          />
        )}
        {kind === "whispers" && <p>{t("moderation.workspacePanels.accountWhispers")}</p>}
        {kind === "activity" && activityTypes.length > 0 && (
          <p>
            {t("moderation.workspacePanels.activityCoverage", { types: activityTypes.join(", ") })}
          </p>
        )}
        {kind === "activity" && actorId !== channelId && (
          <p>{t("moderation.workspacePanels.activityRemote")}</p>
        )}
        {feed.coverage && (
          <p>
            {t("moderation.workspacePanels.coverage", {
              time: new Date(feed.coverage).toLocaleString(),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <NativeModView channelName={channelName} />
          {kind === "suspicious" && !management.allowed && (
            <button className={panelButton} onClick={management.reconnect}>
              {t("moderation.workspacePanels.grantManage")}
            </button>
          )}
          {kind === "activity" && feed.missingScopes.length > 0 && feed.state !== "permission" && (
            <button
              className={panelButton}
              onClick={() =>
                useReconnectDialogStore.getState().open({
                  platform: "twitch",
                  missingScopes: feed.missingScopes,
                  onReconnected: feed.retry,
                })
              }
            >
              {t("moderation.workspacePanels.reconnect")}
            </button>
          )}
        </div>
      </div>
      <PanelFeedback
        state={
          feed.state === "permission"
            ? "permission"
            : feed.state === "error"
              ? "error"
              : feed.state === "connecting"
                ? "loading"
                : "ready"
        }
        error={feed.error}
        scopes={feed.missingScopes}
        retry={feed.retry}
      >
        <p className="py-2" role="status">
          {t(`moderation.workspacePanels.${feed.state}`)}
        </p>
      </PanelFeedback>
      {feed.events.length === 0 && feed.state === "connected" && (
        <p className="py-3">{t("moderation.workspacePanels.emptyFeed")}</p>
      )}
      {feed.events.length > 0 && filteredEvents.length === 0 && (
        <p className="py-3" role="status">
          {t("moderation.workspacePanels.noMatchingEvents")}
        </p>
      )}
      {feed.events.length >= 100 && <p>{t("moderation.workspacePanels.limit")}</p>}
      <ul>
        {filteredEvents.map((event) => (
          <FeedRow key={event.id} event={event} canManage={management.allowed} actorId={actorId} />
        ))}
      </ul>
    </section>
  );
}
