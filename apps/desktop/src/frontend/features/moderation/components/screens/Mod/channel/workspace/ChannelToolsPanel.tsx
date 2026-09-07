import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChannelToolAccess } from "../../../../../capabilities/channel-tools";
import { autoModCategories, type AutoModPolicy } from "../../../../../capabilities/channel-tools";
import { getChannelTools } from "../../../../../composition/channel-tools";
import { useToolResource } from "../../../../hooks/useToolResource";
import { StreamInfoTool } from "./StreamInfoTool";
import {
  NativeModViewLink,
  ToolAccessGate,
  ToolError,
  toolButtonClass,
  toolInputClass,
} from "./ToolAccessGate";

interface ToolProps {
  channelId: string;
  actorId: string;
  refreshCounter: number;
  canManage: boolean;
}

function ShieldTool({ channelId, actorId, refreshCounter, canManage }: ToolProps) {
  const { t } = useTranslation();
  const load = useCallback(
    () => getChannelTools().shield.get(channelId, actorId),
    [channelId, actorId]
  );
  const resource = useToolResource(load, refreshCounter);
  return (
    <div className="space-y-3 p-3">
      <ToolError error={resource.error} retry={resource.retry} />
      {resource.loading ? (
        <p role="status">{t("moderation.loading")}</p>
      ) : (
        typeof resource.value === "boolean" && (
          <>
            <p className="text-sm" role="status">
              {t(
                resource.value ? "moderation.tools.shieldActive" : "moderation.tools.shieldInactive"
              )}
            </p>
            <button
              className={toolButtonClass}
              disabled={!canManage || resource.busy || Boolean(resource.error)}
              onClick={() =>
                void resource.run(() =>
                  getChannelTools().shield.set(channelId, actorId, !resource.value)
                )
              }
            >
              {t(
                resource.value
                  ? "moderation.tools.deactivateShield"
                  : "moderation.tools.activateShield"
              )}
            </button>
          </>
        )
      )}
    </div>
  );
}

function AutoModSettingsTool({ channelId, actorId, refreshCounter, canManage }: ToolProps) {
  const { t } = useTranslation();
  const load = useCallback(
    () => getChannelTools().autoMod.get(channelId, actorId),
    [channelId, actorId]
  );
  const resource = useToolResource(load, refreshCounter);
  const [draft, setDraft] = useState<AutoModPolicy | null>(null);
  const policy = draft ?? resource.value;
  return (
    <div className="space-y-3 p-3">
      <ToolError error={resource.error} retry={resource.retry} />
      {resource.loading && <p role="status">{t("moderation.loading")}</p>}
      {policy && (
        <>
          <label className="block space-y-2 text-xs">
            {t("moderation.tools.filterLevel")}
            <select
              className={toolInputClass}
              value={policy.level ?? "custom"}
              disabled={!canManage || resource.busy || resource.loading}
              onChange={(event) =>
                setDraft({
                  ...policy,
                  level: event.target.value === "custom" ? null : Number(event.target.value),
                })
              }
            >
              <option value="custom">{t("moderation.tools.customPolicy")}</option>
              {[0, 1, 2, 3, 4].map((level) => (
                <option key={level} value={level}>
                  {t("moderation.tools.level", { level })}
                </option>
              ))}
            </select>
          </label>
          {policy.level === null && (
            <div className="grid gap-2">
              {autoModCategories.map((category) => (
                <label key={category} className="flex items-center justify-between gap-2 text-xs">
                  <span>{t(`moderation.tools.categories.${category}`)}</span>
                  <select
                    className={`${toolInputClass} max-w-24`}
                    value={policy.categories[category]}
                    disabled={!canManage || resource.busy || resource.loading}
                    onChange={(event) =>
                      setDraft({
                        ...policy,
                        categories: {
                          ...policy.categories,
                          [category]: Number(event.target.value),
                        },
                      })
                    }
                  >
                    {[0, 1, 2, 3, 4].map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--color-foreground-muted)]">
            {t("moderation.tools.policyWarning")}
          </p>
          <button
            className={toolButtonClass}
            disabled={!canManage || draft === null || resource.busy || resource.loading}
            onClick={async () => {
              if (
                draft !== null &&
                (await resource.run(() => getChannelTools().autoMod.set(channelId, actorId, draft)))
              )
                setDraft(null);
            }}
          >
            {t("moderation.tools.savePolicy")}
          </button>
        </>
      )}
    </div>
  );
}

function BlockedTermsTool({ channelId, actorId, refreshCounter, canManage }: ToolProps) {
  const { t } = useTranslation();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const load = useCallback(
    () => getChannelTools().terms.list(channelId, actorId, cursor),
    [channelId, actorId, cursor]
  );
  const resource = useToolResource(load, refreshCounter);
  const [text, setText] = useState("");
  const disabled = resource.busy || resource.loading || Boolean(resource.error);
  return (
    <div className="space-y-3 p-3">
      <ToolError error={resource.error} retry={resource.retry} />
      {resource.loading && <p role="status">{t("moderation.loading")}</p>}
      {canManage && (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (text.trim().length < 2) return;
            if (
              await resource.run(() => getChannelTools().terms.add(channelId, actorId, text.trim()))
            ) {
              setText("");
              setCursors([undefined]);
            }
          }}
        >
          <label className="block text-xs">
            {t("moderation.tools.newTerm")}
            <input
              className={toolInputClass}
              value={text}
              minLength={2}
              maxLength={500}
              required
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button className={toolButtonClass} disabled={disabled || text.trim().length < 2}>
            {t("moderation.tools.addTerm")}
          </button>
        </form>
      )}
      {!resource.loading && !resource.error && resource.value?.terms.length === 0 && (
        <p className="text-xs">{t("moderation.tools.noTerms")}</p>
      )}
      <ul className="divide-y divide-[var(--color-border)]">
        {resource.value?.terms.map((term) => (
          <li key={term.id} className="flex items-center justify-between gap-2 py-2 text-xs">
            <span className="min-w-0 break-words">{term.text}</span>
            <button
              className={toolButtonClass}
              disabled={disabled || !canManage}
              onClick={() =>
                void resource.run(() => getChannelTools().terms.remove(channelId, actorId, term.id))
              }
              aria-label={t("moderation.tools.removeTerm", { term: term.text })}
            >
              {t("moderation.tools.remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          className={toolButtonClass}
          disabled={disabled || cursors.length < 2}
          onClick={() => setCursors((current) => current.slice(0, -1))}
        >
          {t("moderation.tools.previous")}
        </button>
        <button
          className={toolButtonClass}
          disabled={disabled || !resource.value?.cursor}
          onClick={() => {
            if (resource.value?.cursor)
              setCursors((current) => [...current, resource.value?.cursor]);
          }}
        >
          {t("moderation.tools.next")}
        </button>
      </div>
    </div>
  );
}

export function ChannelToolsPanel({
  channelId,
  channel,
  actorId,
  refreshCounter,
  access,
  requestScopes,
}: {
  channelId: string;
  channel: string;
  actorId: string;
  refreshCounter: number;
  access: ChannelToolAccess;
  requestScopes: (scopes: string[]) => void;
}) {
  const { t } = useTranslation();
  const props = { channelId, actorId, refreshCounter };
  return (
    <div className="divide-y divide-[var(--color-border)] text-white">
      <section>
        <h3 className="px-3 pt-3 text-sm font-semibold">
          {t("moderation.tools.streamInfo.title")}
        </h3>
        <ToolAccessGate
          access={access["stream-info"]}
          channel={channel}
          requestScopes={requestScopes}
        >
          <StreamInfoTool
            key={channelId + actorId}
            channelId={channelId}
            channel={channel}
            refreshCounter={refreshCounter}
          />
        </ToolAccessGate>
      </section>
      <section>
        <h3 className="px-3 pt-3 text-sm font-semibold">{t("moderation.tools.shield")}</h3>
        <ToolAccessGate access={access.shield} channel={channel} requestScopes={requestScopes}>
          <ShieldTool key={channelId + actorId} {...props} canManage={access.shield.canManage} />
        </ToolAccessGate>
      </section>
      <section>
        <h3 className="px-3 pt-3 text-sm font-semibold">{t("moderation.tools.autoModSettings")}</h3>
        <ToolAccessGate
          access={access["automod-settings"]}
          channel={channel}
          requestScopes={requestScopes}
        >
          <AutoModSettingsTool
            key={channelId + actorId}
            {...props}
            canManage={access["automod-settings"].canManage}
          />
        </ToolAccessGate>
      </section>
      <section>
        <h3 className="px-3 pt-3 text-sm font-semibold">{t("moderation.tools.blockedTerms")}</h3>
        <ToolAccessGate
          access={access["blocked-terms"]}
          channel={channel}
          requestScopes={requestScopes}
        >
          <BlockedTermsTool
            key={channelId + actorId}
            {...props}
            canManage={access["blocked-terms"].canManage}
          />
        </ToolAccessGate>
      </section>
      <div className="space-y-2 p-3 text-xs text-[var(--color-foreground-muted)]">
        <p>{t("moderation.tools.nativeTerms")}</p>
        <NativeModViewLink channel={channel} />
      </div>
    </div>
  );
}
