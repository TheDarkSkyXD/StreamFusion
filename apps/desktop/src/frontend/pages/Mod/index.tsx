/**
 * /mod — Moderation index.
 *
 * Thin landing page: lists every channel the signed-in user can moderate
 * (one card per channel, linking to `/mod/<platform>/$channel`) and the
 * Global retention card for context.
 *
 * Per-channel admin sections (banned-users, mod-log, engagement, channel-
 * scoped retention) live on the per-channel pages — see
 * src/frontend/pages/Mod/channel/ModChannelPage.tsx.
 *
 * Refresh button bumps the moderated-channels store hydrate so a freshly-
 * promoted mod sees their new channel without a full reload.
 */

import { useCallback } from "react";
import { LuRefreshCw } from "react-icons/lu";
import { useTranslation } from "react-i18next";

import { useAuthStore } from "@/store/auth-store";
import { useModeratedChannelsStore } from "@/features/moderation/data/moderated-channels-store";

import { ChannelList } from "./ChannelList";
import { GlobalRetention } from "./GlobalRetention";

export function ModPage() {
  const { t } = useTranslation();
  const triggerRefresh = useCallback(async () => {
    const twitchUser = useAuthStore.getState().twitchUser;
    if (!twitchUser) return;
    try {
      await useModeratedChannelsStore.getState().hydrate(twitchUser.id);
    } catch {
      // Hydrate errors are silenced — store handles its own 401 tolerance.
    }
  }, []);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{t("moderation.moderation")}</h1>
        <button
          type="button"
          onClick={() => void triggerRefresh()}
          aria-label={t("moderation.refreshData")}
          className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
        >
          <LuRefreshCw size={16} />
          {t("moderation.refresh")}
        </button>
      </header>
      <ChannelList />
      <GlobalRetention />
    </div>
  );
}
