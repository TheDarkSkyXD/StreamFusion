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
import { LuRefreshCw, LuShieldCheck } from "react-icons/lu";
import { useTranslation } from "react-i18next";

import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { useModeratedChannelsStore } from "@/features/moderation/components/state/moderated-channels-store";

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
    <div className="h-full overflow-y-auto bg-[#0e0e10] p-4 font-[Inter] text-sm text-[#efeff1] sm:p-5">
      <header className="flex min-h-11 items-center justify-between rounded-md border border-[#303034] bg-[#18181b] px-3">
        <div className="flex items-center gap-2">
          <LuShieldCheck className="text-[#bf94ff]" size={18} aria-hidden="true" />
          <div>
            <h1 className="text-sm font-semibold text-white">{t("moderation.moderation")}</h1>
            <p className="text-xs text-[#adadb8]">
              {t("moderation.yourChannels", { defaultValue: "Your channels" })}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void triggerRefresh()}
          aria-label={t("moderation.refreshData")}
          className="flex h-8 items-center gap-2 rounded-md bg-[#9147ff] px-3 text-xs font-semibold text-white hover:bg-[#772ce8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf94ff]"
        >
          <LuRefreshCw size={16} />
          {t("moderation.refresh")}
        </button>
      </header>
      <main className="mx-auto grid w-full max-w-6xl gap-2 pt-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ChannelList />
        <GlobalRetention />
      </main>
    </div>
  );
}
