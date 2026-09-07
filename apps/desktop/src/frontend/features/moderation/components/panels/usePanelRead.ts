import { useEffect, useState } from "react";
import type { TwitchApiResult } from "@shared/twitch-api-types";
import { getWorkspacePanelsPort } from "../../composition/workspace-panels";

export function usePanelRead<T>(
  actorId: string | undefined,
  refreshCounter: number | string,
  scopes: readonly (readonly string[])[],
  load: () => Promise<TwitchApiResult<T>>
) {
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{
    state: "loading" | "ready" | "error" | "permission";
    data: T | null;
    error: string | null;
    missingScopes: string[];
  }>({ state: "loading", data: null, error: null, missingScopes: [] });
  useEffect(() => {
    let cancelled = false;
    setView({ state: "loading", data: null, error: null, missingScopes: [] });
    void (async () => {
      try {
        if (!actorId) {
          if (!cancelled)
            setView({ state: "permission", data: null, error: null, missingScopes: [] });
          return;
        }
        const token = await getWorkspacePanelsPort().tokenStatus();
        if (cancelled) return;
        const missingScopes = scopes
          .filter((group) => !group.some((scope) => token.scopes?.includes(scope)))
          .map((group) => group[0]);
        if (!token.valid || token.userId !== actorId || missingScopes.length) {
          setView({ state: "permission", data: null, error: null, missingScopes });
          return;
        }
        const result = await load();
        if (cancelled) return;
        if (result.ok)
          setView({ state: "ready", data: result.data, error: null, missingScopes: [] });
        else
          setView({
            state:
              result.error.code === "missing-scope" || result.error.code === "unauthorized"
                ? "permission"
                : "error",
            data: null,
            error: result.error.message,
            missingScopes,
          });
      } catch (error) {
        if (!cancelled)
          setView({
            state: "error",
            data: null,
            error: error instanceof Error ? error.message : null,
            missingScopes: [],
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actorId, refreshCounter, scopes, load, revision]);
  return { ...view, retry: () => setRevision((v) => v + 1) };
}
