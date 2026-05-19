/**
 * /mod — Moderation index.
 *
 * Thin landing page: lists every channel the signed-in user can moderate
 * (one card per channel, linking to `/mod/<platform>/$channel`) and the
 * Global retention card for context.
 *
 * Per-channel admin sections (banned-users, mod-log, engagement, channel-
 * scoped retention) live on the per-channel pages — see
 * src/pages/Mod/channel/ModChannelPage.tsx.
 *
 * Refresh button bumps the moderated-channels store hydrate so a freshly-
 * promoted mod sees their new channel without a full reload.
 */

import { useCallback } from "react";
import { LuRefreshCw } from "react-icons/lu";

import { useAuthStore } from "@/store/auth-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

import { ChannelList } from "./ChannelList";
import { GlobalRetention } from "./GlobalRetention";

export function ModPage() {
  const triggerRefresh = useCallback(async () => {
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
      // Hydrate errors are silenced — store handles its own 401 tolerance.
    }
  }, []);

  return (
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
      <ChannelList />
      <GlobalRetention />
    </div>
  );
}
