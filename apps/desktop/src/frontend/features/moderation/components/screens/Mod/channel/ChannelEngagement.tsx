import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ChannelToolAccess,
  EngagementItem,
  ToolAccess,
} from "../../../../capabilities/channel-tools";
import { getChannelTools } from "../../../../composition/channel-tools";
import { useToolResource } from "../../../hooks/useToolResource";
import {
  ToolAccessGate,
  ToolError,
  toolButtonClass,
  toolInputClass,
} from "./workspace/ToolAccessGate";

type Kind = "polls" | "predictions";
type EndAction = Parameters<ReturnType<typeof getChannelTools>["engagement"]["end"]>[3];

function EngagementTool({
  kind,
  broadcasterId,
  refreshCounter,
  canManage,
}: {
  kind: Kind;
  broadcasterId: string;
  refreshCounter: number;
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation();
  const prefix = useId();
  const load = useCallback(
    () =>
      broadcasterId ? getChannelTools().engagement.list(kind, broadcasterId) : Promise.resolve([]),
    [broadcasterId, kind]
  );
  const resource = useToolResource(load, refreshCounter);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [duration, setDuration] = useState(300);
  const [pending, setPending] = useState<{
    item: EngagementItem;
    action: EndAction;
    winnerId?: string;
  } | null>(null);
  const isPoll = kind === "polls";
  const current = resource.value?.find(
    (item) => item.status === "ACTIVE" || item.status === "LOCKED"
  );
  const history = resource.value?.filter((item) => item !== current) ?? [];
  const disabled =
    resource.busy ||
    resource.loading ||
    Boolean(resource.error) ||
    resource.value === undefined ||
    !canManage;
  const actionLabel = (action: EndAction) => t(`moderation.tools.actions.${action}`);
  const requestEnd = (item: EngagementItem, action: EndAction, winnerId?: string) =>
    setPending({ item, action, winnerId });
  const renderItem = (item: EngagementItem) => (
    <div
      key={item.id}
      className="space-y-2 rounded-md border border-[var(--color-border)] p-3"
      data-testid={isPoll ? "channel-engagement-poll" : "channel-engagement-prediction"}
    >
      <p className="text-xs text-[var(--color-foreground-muted)]">{item.status}</p>
      <h4 className="text-sm font-semibold">{item.title}</h4>
      <ul className="space-y-2">
        {item.options.map((option) => (
          <li key={option.id} className="flex items-center justify-between gap-2 text-xs">
            <span>
              {option.title}: {new Intl.NumberFormat(i18n.resolvedLanguage).format(option.score)}
            </span>
            {!isPoll && item.status === "LOCKED" && (
              <button
                className={toolButtonClass}
                disabled={disabled}
                onClick={() => requestEnd(item, "RESOLVED", option.id)}
              >
                {t("moderation.tools.chooseWinner")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {isPoll && item.status === "ACTIVE" && (
          <button
            className={toolButtonClass}
            disabled={disabled}
            onClick={() => requestEnd(item, "TERMINATED")}
          >
            {actionLabel("TERMINATED")}
          </button>
        )}
        {isPoll && ["COMPLETED", "TERMINATED"].includes(item.status) && (
          <button
            className={toolButtonClass}
            disabled={disabled}
            onClick={() => requestEnd(item, "ARCHIVED")}
          >
            {actionLabel("ARCHIVED")}
          </button>
        )}
        {!isPoll && item.status === "ACTIVE" && (
          <button
            className={toolButtonClass}
            disabled={disabled}
            onClick={() => requestEnd(item, "LOCKED")}
          >
            {actionLabel("LOCKED")}
          </button>
        )}
        {!isPoll && ["ACTIVE", "LOCKED"].includes(item.status) && (
          <button
            className={toolButtonClass}
            disabled={disabled}
            onClick={() => requestEnd(item, "CANCELED")}
          >
            {actionLabel("CANCELED")}
          </button>
        )}
      </div>
    </div>
  );
  return (
    <section className="space-y-3 p-3" aria-labelledby={prefix}>
      <h3 id={prefix} className="text-sm font-semibold">
        {t(`moderation.tools.${kind}`)}
      </h3>
      <ToolError error={resource.error} retry={resource.retry} />
      {resource.loading && (
        <p role="status" className="text-xs">
          {t("moderation.loading")}
        </p>
      )}
      {current && renderItem(current)}
      {!resource.loading && !resource.error && !current && (
        <p
          className="text-xs text-[var(--color-foreground-muted)]"
          data-testid={isPoll ? "channel-engagement-empty" : "prediction-empty"}
        >
          {t("moderation.tools.noActive", { tool: t(`moderation.tools.${kind}`) })}
        </p>
      )}
      {!current && canManage && !creating && (
        <button className={toolButtonClass} disabled={disabled} onClick={() => setCreating(true)}>
          {t("moderation.tools.create", { tool: t(`moderation.tools.${kind}`) })}
        </button>
      )}
      {creating && (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (disabled || options.some((option) => !option.trim()) || !title.trim()) return;
            if (
              await resource.run(() =>
                getChannelTools().engagement.create(
                  kind,
                  broadcasterId,
                  title.trim(),
                  options.map((option) => option.trim()),
                  duration
                )
              )
            ) {
              setCreating(false);
              setTitle("");
              setOptions(["", ""]);
            }
          }}
        >
          <label className="block text-xs">
            {t("moderation.tools.title")}
            <input
              className={toolInputClass}
              value={title}
              required
              maxLength={isPoll ? 60 : 45}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {options.map((option, index) => (
            <label key={index} className="block text-xs">
              {t("moderation.tools.option", { number: index + 1 })}
              <input
                className={toolInputClass}
                required
                maxLength={25}
                value={option}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((value, at) => (at === index ? event.target.value : value))
                  )
                }
              />
            </label>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              className={toolButtonClass}
              disabled={options.length >= (isPoll ? 5 : 10)}
              onClick={() => setOptions((current) => [...current, ""])}
            >
              {t("moderation.tools.addOption")}
            </button>
            <button
              type="button"
              className={toolButtonClass}
              disabled={options.length <= 2}
              onClick={() => setOptions((current) => current.slice(0, -1))}
            >
              {t("moderation.tools.removeOption")}
            </button>
          </div>
          <label className="block text-xs">
            {t("moderation.tools.duration")}
            <input
              className={toolInputClass}
              type="number"
              required
              min={isPoll ? 15 : 1}
              max={1800}
              value={duration}
              onChange={(event) => setDuration(event.target.valueAsNumber)}
            />
          </label>
          <div className="flex gap-2">
            <button className={toolButtonClass} disabled={disabled} type="submit">
              {t("moderation.tools.start")}
            </button>
            <button
              className={toolButtonClass}
              type="button"
              disabled={resource.busy}
              onClick={() => setCreating(false)}
            >
              {t("moderation.tools.cancel")}
            </button>
          </div>
        </form>
      )}
      {pending && (
        <div
          className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          role="group"
          aria-label={t("moderation.tools.confirmAction")}
        >
          <p className="text-sm">
            {actionLabel(pending.action)}: {pending.item.title}
            {pending.winnerId
              ? " ? " + pending.item.options.find((option) => option.id === pending.winnerId)?.title
              : ""}
          </p>
          <div className="flex gap-2">
            <button
              className={toolButtonClass}
              disabled={disabled}
              onClick={async () => {
                if (
                  await resource.run(() =>
                    getChannelTools().engagement.end(
                      kind,
                      broadcasterId,
                      pending.item.id,
                      pending.action,
                      pending.winnerId
                    )
                  )
                )
                  setPending(null);
              }}
            >
              {t("moderation.tools.confirm")}
            </button>
            <button
              className={toolButtonClass}
              disabled={resource.busy}
              onClick={() => setPending(null)}
            >
              {t("moderation.tools.cancel")}
            </button>
          </div>
        </div>
      )}
      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs">{t("moderation.tools.recent")}</summary>
          <div className="mt-2 space-y-2">{history.map(renderItem)}</div>
        </details>
      )}
    </section>
  );
}

export function ChannelEngagement({
  broadcasterId,
  refreshCounter = 0,
  access,
  channel = "",
  requestScopes = () => {},
}: {
  broadcasterId: string;
  refreshCounter?: number;
  access?: Pick<ChannelToolAccess, "polls" | "predictions">;
  channel?: string;
  requestScopes?: (scopes: string[]) => void;
}) {
  return (
    <div data-testid="channel-engagement" className="divide-y divide-[var(--color-border)]">
      {(["polls", "predictions"] as const).map((kind) => {
        const grant: ToolAccess | undefined = access?.[kind];
        const content = (
          <EngagementTool
            key={broadcasterId + kind}
            kind={kind}
            broadcasterId={broadcasterId}
            refreshCounter={refreshCounter}
            canManage={grant?.canManage ?? false}
          />
        );
        return grant ? (
          <ToolAccessGate key={kind} access={grant} channel={channel} requestScopes={requestScopes}>
            {content}
          </ToolAccessGate>
        ) : (
          content
        );
      })}
    </div>
  );
}
