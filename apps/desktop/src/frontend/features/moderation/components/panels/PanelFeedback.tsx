import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useReconnectDialogStore } from "@/features/auth/components/state/reconnect-dialog-store";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";
export const panelButton =
  "rounded bg-[#35353b] px-2 py-1 text-xs text-white hover:bg-[#45454d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf94ff] disabled:opacity-50";
export function NativeModView({ channelName }: { channelName: string }) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  return (
    <>
      <button
        className={panelButton}
        onClick={() => {
          setError(false);
          void getWorkspacePanelsPort()
            .openTwitch(channelName)
            .catch(() => setError(true));
        }}
      >
        {t("moderation.workspacePanels.native")}
      </button>
      {error && <p role="alert">{t("moderation.workspacePanels.nativeError")}</p>}
    </>
  );
}
export function PanelFeedback({
  state,
  error,
  scopes = [],
  retry,
  children,
}: {
  state: "loading" | "permission" | "error" | "ready";
  error?: string | null;
  scopes?: string[];
  retry: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (state === "ready") return children;
  return (
    <div
      className="space-y-2 py-3 text-xs text-[#adadb8]"
      role={state === "error" ? "alert" : "status"}
    >
      <p>{t(`moderation.workspacePanels.${state}`)}</p>
      {error && <p>{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {state === "permission" && (
          <button
            className={panelButton}
            onClick={() =>
              useReconnectDialogStore
                .getState()
                .open({ platform: "twitch", missingScopes: scopes, onReconnected: retry })
            }
          >
            {t("moderation.workspacePanels.reconnect")}
          </button>
        )}
        {state !== "loading" && (
          <button className={panelButton} onClick={retry}>
            {t("moderation.workspacePanels.retry")}
          </button>
        )}
      </div>
    </div>
  );
}
