import type { ReactNode } from "react";
import { useState } from "react";
import { getChannelTools } from "../../../../../composition/channel-tools";
import { useTranslation } from "react-i18next";
import type { ToolAccess } from "../../../../../capabilities/channel-tools";

export const toolButtonClass =
  "rounded-md border border-[var(--color-border)] bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9146ff]";
export const toolInputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9146ff]";

export function NativeModViewLink({ channel }: { channel: string }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={toolButtonClass}
        onClick={() => {
          setError(null);
          void getChannelTools()
            .openNativeView(channel)
            .catch((failure: unknown) =>
              setError(failure instanceof Error ? failure.message : String(failure))
            );
        }}
      >
        {t("moderation.tools.openTwitch", { defaultValue: "Open Twitch Mod View" })}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function ToolAccessGate({
  access,
  channel,
  requestScopes,
  children,
}: {
  access: ToolAccess;
  channel: string;
  requestScopes: (scopes: string[]) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (access.broadcasterOnly)
    return (
      <div className="space-y-3 p-3 text-sm">
        <p>
          {t("moderation.tools.broadcasterOnly", {
            defaultValue:
              "Twitch requires the broadcaster's authorization for this tool in StreamFusion.",
          })}
        </p>
        <NativeModViewLink channel={channel} />
      </div>
    );
  return (
    <>
      {!access.canManage && (
        <div className="space-y-2 border-b border-[var(--color-border)] p-3 text-xs text-[var(--color-foreground-muted)]">
          <p>
            {t(
              access.canRead ? "moderation.tools.readOnly" : "moderation.tools.permissionRequired",
              {
                defaultValue: access.canRead
                  ? "You can view this tool. Reconnect to enable changes."
                  : "Reconnect Twitch to enable this tool.",
              }
            )}
          </p>
          <button
            type="button"
            className={toolButtonClass}
            onClick={() =>
              requestScopes(access.canRead ? access.missingWriteScopes : access.missingReadScopes)
            }
          >
            {t("moderation.tools.reconnect", { defaultValue: "Reconnect Twitch" })}
          </button>
        </div>
      )}
      {access.canRead && children}
    </>
  );
}

export function ToolError({ error, retry }: { error: string | null; retry: () => void }) {
  const { t } = useTranslation();
  return error ? (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm"
    >
      <p>{error}</p>
      <button type="button" className={toolButtonClass} onClick={retry}>
        {t("moderation.tools.retry", { defaultValue: "Retry" })}
      </button>
    </div>
  ) : null;
}
