import { AlertCircle, LoaderCircle, Shield } from "lucide-react";

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
import { KICK_APP_SCOPES, TWITCH_APP_SCOPES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "user:read:email": "Read your Twitch account email",
  "user:read:follows": "Read the channels you follow",
  "user:read:subscriptions": "Read your channel subscriptions",
  "user:read:emotes": "Load your subscribed-channel emotes",
  "chat:read": "Read Twitch chat while signed in",
  "chat:edit": "Send Twitch chat messages",
  "user:read:moderated_channels": "See which channels you moderate",
  "moderator:read:followers": "Verify channel follow relationships",
  "moderator:read:blocked_terms": "Read channel blocked terms",
  "moderator:read:chat_settings": "Read channel chat settings",
  "moderator:read:moderators": "Read channel moderators",
  "moderator:read:vips": "Read channel VIPs",
  "moderator:manage:chat_messages": "Pin, unpin, and delete chat messages",
  "moderator:manage:banned_users": "Time out, ban, and unban users",
  "moderator:manage:warnings": "Warn users in chat",
  "moderator:manage:shield_mode": "Toggle Shield Mode",
  "channel:manage:raids": "Start and cancel raids",
  "channel:manage:moderators": "Add and remove moderators",
  "channel:manage:vips": "Add and remove VIPs",
  "channel:manage:predictions": "Create, lock, and resolve predictions",
  "channel:manage:polls": "Create and terminate polls",
  "channel:edit:commercial": "Start commercial breaks",
  "user:manage:whispers": "Send whispers",
  "moderator:read:unban_requests": "Review unban requests",
  "moderator:manage:unban_requests": "Approve or deny unban requests",
  "user:read": "Read your Kick account",
  "channel:read": "Read Kick channel details",
  "moderation:chat_message:manage": "Delete Kick chat messages",
  "moderation:ban": "Time out, ban, and unban Kick users",
  "events:subscribe": "Receive Kick channel and moderation events",
};

export function ReconnectForModDialog() {
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
      ? `Waiting for ${platformLabel} authorization…`
      : phase === "revalidating"
        ? "Revalidating permissions and moderation access…"
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
            Reconnect {platformLabel}
          </DialogTitle>
          <DialogDescription className="pt-2 text-[var(--color-foreground-muted)]">
            StreamFusion needs the permissions below to verify moderation access and show the
            Platform actions available in this channel.
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
                <span>{SCOPE_DESCRIPTIONS[scope] ?? scope}</span>
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
              Reconnect failed · Retry
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 pt-4">
          <Button variant="outline" onClick={close} disabled={busy}>
            Not now
          </Button>
          <Button
            onClick={() => void handleReconnect()}
            disabled={busy}
            className="bg-[var(--color-storm-primary)] text-white hover:opacity-90"
          >
            {busy ? "Reconnecting…" : phase === "failed" ? "Retry" : `Reconnect ${platformLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
