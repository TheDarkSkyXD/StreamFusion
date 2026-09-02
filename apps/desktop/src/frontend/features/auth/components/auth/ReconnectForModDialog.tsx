import { AlertCircle, LoaderCircle, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { logger } from "@/renderer/logging/logger";
import type { authEn } from "@/i18n/locales/en/auth";
import { KICK_APP_SCOPES, TWITCH_APP_SCOPES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

type ScopeDescriptionKey =
  `auth.scopeDescriptions.${keyof typeof authEn.auth.scopeDescriptions & string}`;

const SCOPE_DESCRIPTIONS: Record<string, ScopeDescriptionKey> = {
  "user:read:email": "auth.scopeDescriptions.userReadEmail",
  "user:read:follows": "auth.scopeDescriptions.userReadFollows",
  "user:read:subscriptions": "auth.scopeDescriptions.userReadSubscriptions",
  "user:read:emotes": "auth.scopeDescriptions.userReadEmotes",
  "chat:read": "auth.scopeDescriptions.chatRead",
  "chat:edit": "auth.scopeDescriptions.chatEdit",
  "user:read:moderated_channels": "auth.scopeDescriptions.userReadModeratedChannels",
  "moderator:read:followers": "auth.scopeDescriptions.moderatorReadFollowers",
  "moderator:read:blocked_terms": "auth.scopeDescriptions.moderatorReadBlockedTerms",
  "moderator:read:chat_settings": "auth.scopeDescriptions.moderatorReadChatSettings",
  "moderator:read:moderators": "auth.scopeDescriptions.moderatorReadModerators",
  "moderator:read:vips": "auth.scopeDescriptions.moderatorReadVips",
  "moderator:manage:chat_messages": "auth.scopeDescriptions.moderatorManageChatMessages",
  "moderator:manage:banned_users": "auth.scopeDescriptions.moderatorManageBannedUsers",
  "moderator:manage:warnings": "auth.scopeDescriptions.moderatorManageWarnings",
  "moderator:manage:shield_mode": "auth.scopeDescriptions.moderatorManageShieldMode",
  "channel:manage:raids": "auth.scopeDescriptions.channelManageRaids",
  "channel:manage:moderators": "auth.scopeDescriptions.channelManageModerators",
  "channel:manage:vips": "auth.scopeDescriptions.channelManageVips",
  "channel:manage:predictions": "auth.scopeDescriptions.channelManagePredictions",
  "channel:manage:polls": "auth.scopeDescriptions.channelManagePolls",
  "channel:edit:commercial": "auth.scopeDescriptions.channelEditCommercial",
  "user:manage:whispers": "auth.scopeDescriptions.userManageWhispers",
  "moderator:read:unban_requests": "auth.scopeDescriptions.moderatorReadUnbanRequests",
  "moderator:manage:unban_requests": "auth.scopeDescriptions.moderatorManageUnbanRequests",
  "user:read": "auth.scopeDescriptions.kickUserRead",
  "channel:read": "auth.scopeDescriptions.kickChannelRead",
  "moderation:chat_message:manage": "auth.scopeDescriptions.kickChatMessageManage",
  "moderation:ban": "auth.scopeDescriptions.kickBan",
  "events:subscribe": "auth.scopeDescriptions.kickEventsSubscribe",
};

export function ReconnectForModDialog() {
  const { t } = useTranslation();
  const isOpen = useReconnectDialogStore((state) => state.isOpen);
  const platform = useReconnectDialogStore((state) => state.platform);
  const phase = useReconnectDialogStore((state) => state.phase);
  const missingScopes = useReconnectDialogStore((state) => state.missingScopes);
  const close = useReconnectDialogStore((state) => state.close);
  const setPhase = useReconnectDialogStore((state) => state.setPhase);
  const fireReconnected = useReconnectDialogStore((state) => state.fireReconnected);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loginKick = useAuthStore((state) => state.loginKick);
  const platformLabel = platform === "twitch" ? "Twitch" : "Kick";
  const busy = phase === "submitting" || phase === "revalidating";

  const handleReconnect = async () => {
    const currentState = useReconnectDialogStore.getState();
    if (
      currentState.phase === "submitting" ||
      currentState.phase === "revalidating" ||
      !currentState.isOpen
    ) {
      return;
    }
    try {
      setPhase("submitting");
      await (platform === "twitch" ? loginTwitch() : loginKick());
      setPhase("revalidating");

      const status = await window.electronAPI.auth.tokenStatus(platform);
      if (!status.connected || !status.valid) {
        throw new Error(`${platformLabel} did not return a valid connected session`);
      }
      const grantedScopes = new Set(status.scopes ?? []);
      const canonical = platform === "twitch" ? TWITCH_APP_SCOPES : KICK_APP_SCOPES;
      const requiredScopes = Array.from(new Set([...canonical, ...missingScopes]));
      const stillMissingScopes = requiredScopes.filter((scope) => !grantedScopes.has(scope));
      if (stillMissingScopes.length > 0) {
        logger.warn("UI:Auth:Reconnect", "reconnect completed but scopes are still missing", {
          platform,
          missingScopes: stillMissingScopes,
        });
        setPhase("failed");
        return;
      }

      await fireReconnected();
      setPhase("idle");
      close();
    } catch (error) {
      setPhase("failed");
      logger.error("UI:Auth:Reconnect", "reconnect for moderation scopes failed", {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const progressCopy =
    phase === "submitting"
      ? t("auth.waitingForAuthorization", { platform: platformLabel })
      : phase === "revalidating"
        ? t("auth.revalidatingPermissions")
        : "";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent
        className="border-[var(--color-border)] bg-[#0F0F12] p-6 shadow-2xl sm:max-w-[440px]"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-[var(--color-border)] pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <Shield className="h-5 w-5 text-[var(--color-storm-primary)]" aria-hidden />
            {t("auth.reconnectPlatform", { platform: platformLabel })}
          </DialogTitle>
          <DialogDescription className="pt-2 text-[var(--color-foreground-muted)]">
            {t("auth.moderationPermissionsDescription")}
          </DialogDescription>
        </DialogHeader>

        {missingScopes.length > 0 ? (
          <ul className="space-y-2 py-4">
            {missingScopes.map((scope) => (
              <li
                key={scope}
                className="flex items-start gap-2 text-sm text-[var(--color-foreground)]"
                data-scope={scope}
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-storm-primary)]" />
                <span>{SCOPE_DESCRIPTIONS[scope] ? t(SCOPE_DESCRIPTIONS[scope]) : scope}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="min-h-6 text-sm" aria-live="polite" aria-atomic="true">
          {busy ? (
            <p className="flex items-center gap-2 text-[var(--color-foreground-muted)]">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              {progressCopy}
            </p>
          ) : phase === "failed" ? (
            <p className="flex items-center gap-2 text-red-300">
              <AlertCircle className="h-4 w-4" aria-hidden />
              {t("auth.reconnectFailedRetry")}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 pt-4">
          <Button variant="outline" onClick={close} disabled={busy}>
            {t("auth.notNow")}
          </Button>
          <Button
            onClick={() => void handleReconnect()}
            disabled={busy}
            className="bg-[var(--color-storm-primary)] text-white hover:opacity-90"
          >
            {busy
              ? t("auth.reconnecting")
              : phase === "failed"
                ? t("auth.retry")
                : t("auth.reconnectPlatform", { platform: platformLabel })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
