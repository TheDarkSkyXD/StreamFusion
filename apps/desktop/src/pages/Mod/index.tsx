/**
 * U29 — /mod top-level Moderation page.
 *
 * Three stacked sections:
 *   • PerChannelSettings  (U30) — per-channel retention configuration.
 *   • BannedUserSearch    (U31) — cross-channel banned-user lookup.
 *   • EngagementAggregate (U32) — broadcaster-only predictions + polls digest.
 *
 * Refresh policy (plan decision #8): manual icon button + auto-refresh on
 * window focus when the page has been idle for > 5 minutes. The refresh
 * increments a counter that child sections subscribe to via context so they
 * re-fetch in step with the moderated-channels hydrate.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { LuRefreshCw } from "react-icons/lu";

import { useAuthStore } from "@/store/auth-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

import { BannedUserSearch } from "./BannedUserSearch";
import { EngagementAggregate } from "./EngagementAggregate";
import { PerChannelSettings } from "./PerChannelSettings";

const IDLE_MS = 5 * 60_000;

const ModRefreshContext = createContext<number>(0);

/** Child sections call this to know when to re-fetch. */
export function useModRefreshCounter(): number {
  return useContext(ModRefreshContext);
}

export function ModPage() {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const lastActiveAtRef = useRef<number>(Date.now());

  const triggerRefresh = useCallback(async () => {
    setRefreshCounter((n) => n + 1);
    const twitchUser = useAuthStore.getState().twitchUser;
    if (!twitchUser) return;
    try {
      const token = await window.electronAPI.auth.getToken("twitch");
      const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
      if (!token?.accessToken || !clientId) return;
      await useModeratedChannelsStore
        .getState()
        .hydrate(twitchUser.id, token.accessToken, clientId);
    } catch {
      // Token read errors are silenced — the moderated-channels store handles
      // its own 401-tolerant retries; we just bumped the counter so child
      // sections refetch with whatever cached data is current.
    }
  }, []);

  // Window-focus auto-refresh after >5min idle.
  useEffect(() => {
    const onFocus = () => {
      const idleFor = Date.now() - lastActiveAtRef.current;
      lastActiveAtRef.current = Date.now();
      if (idleFor > IDLE_MS) {
        void triggerRefresh();
      }
    };
    const onBlur = () => {
      lastActiveAtRef.current = Date.now();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [triggerRefresh]);

  return (
    <ModRefreshContext.Provider value={refreshCounter}>
      <div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Moderation</h1>
          <button
            type="button"
            onClick={() => void triggerRefresh()}
            aria-label="Refresh moderation data"
            className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
          >
            <LuRefreshCw size={16} />
            Refresh
          </button>
        </header>
        <PerChannelSettings />
        <BannedUserSearch />
        <EngagementAggregate />
      </div>
    </ModRefreshContext.Provider>
  );
}
