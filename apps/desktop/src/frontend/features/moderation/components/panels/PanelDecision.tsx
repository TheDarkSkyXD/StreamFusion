import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TwitchApiResult } from "@shared/twitch-api-types";
import { useReconnectDialogStore } from "@/features/auth/components/state/reconnect-dialog-store";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";
import { panelButton } from "./PanelFeedback";

export function usePanelManagementAccess(actorId: string | undefined, scope: string) {
  const [allowed, setAllowed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setAllowed(false);
    void getWorkspacePanelsPort()
      .tokenStatus()
      .then((token) => {
        if (!cancelled)
          setAllowed(token.valid && token.userId === actorId && !!token.scopes?.includes(scope));
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actorId, scope, revision]);
  return {
    allowed,
    reconnect: () =>
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: [scope],
        onReconnected: () => setRevision((v) => v + 1),
      }),
  };
}
export function PanelDecision<T extends string>({
  actions,
  apply,
  onSuccess,
}: {
  actions: readonly { value: T; label: string }[];
  apply: (value: T) => Promise<TwitchApiResult>;
  onSuccess: (value: T) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const confirm = async () => {
    if (!pending || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await apply(pending);
      if (!mounted.current) return;
      if (result.ok) {
        onSuccess(pending);
        setPending(null);
      } else setError(result.error.message);
    } catch {
      if (mounted.current) setError(t("moderation.workspacePanels.error"));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-2 pt-2">
      {pending ? (
        <>
          <p>
            {t("moderation.workspacePanels.confirmAction", {
              action: actions.find((action) => action.value === pending)?.label ?? "",
            })}
          </p>
          <div className="flex gap-2">
            <button className={panelButton} disabled={busy} onClick={() => void confirm()}>
              {t("moderation.workspacePanels.confirm")}
            </button>
            <button className={panelButton} disabled={busy} onClick={() => setPending(null)}>
              {t("moderation.workspacePanels.keep")}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.value}
              className={panelButton}
              onClick={() => {
                setError(null);
                setPending(action.value);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
