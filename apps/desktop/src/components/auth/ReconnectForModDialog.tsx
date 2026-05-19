/**
 * ReconnectForModDialog
 *
 * Lazy re-consent dialog. Opens via {@link useReconnectDialogStore}.open(),
 * which is invoked by {@link useRequireModScopes}.promptReconnect() when a
 * mod action surface is clicked by a user whose token lacks the new mod
 * scopes (added in U7).
 *
 * On confirm: logs out the current Twitch session and immediately re-runs
 * the OAuth login flow with the expanded scope set from `oauth-config.ts`.
 * Twitch's `force_verify=true` is already set on the auth URL, so the
 * consent screen always renders.
 *
 * U5 — the dialog now reads the `missingScopes` payload off the store and
 * renders one human-readable row per scope so the user sees exactly what
 * the action they just tried needs. One consent round-trip covers every
 * missing scope; on success the registered `onReconnected` callback fires
 * once so the action can retry itself.
 *
 * Mounted once at the app root by AuthProvider.
 */

import { LuShield } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

/**
 * Human-readable descriptions for every Twitch scope the app might ask the
 * user to re-consent to. Unknown scopes fall back to their raw id at render
 * time — kept here (not in the store) so the store stays dumb.
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  // Pin-path scopes (U7).
  "user:read:moderated_channels": "See which channels you moderate",
  "moderator:manage:chat_messages": "Pin, unpin, and delete chat messages",
  // Channel-management console scopes (U4).
  "moderator:manage:banned_users": "Time out, ban, and unban users",
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
};

export function ReconnectForModDialog() {
  const isOpen = useReconnectDialogStore((state) => state.isOpen);
  const missingScopes = useReconnectDialogStore((state) => state.missingScopes);
  const close = useReconnectDialogStore((state) => state.close);
  const fireReconnected = useReconnectDialogStore((state) => state.fireReconnected);
  const logoutTwitch = useAuthStore((state) => state.logoutTwitch);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loading = useAuthStore((state) => state.twitchLoading);

  const handleReconnect = async () => {
    try {
      await logoutTwitch();
      await loginTwitch();
      // Success: fire the retry callback exactly once, then close.
      fireReconnected();
      close();
    } catch (error) {
      // Failure: keep the dialog open so the user can retry. No behavior
      // change vs the pre-U5 path beyond not auto-closing on error.
      console.error("Reconnect for mod scopes failed:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? null : close())}>
      <DialogContent className="sm:max-w-[440px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl">
        <DialogHeader className="pb-4 border-b border-[var(--color-border)]">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <LuShield className="w-5 h-5 text-[var(--color-storm-primary)]" />
            Reconnect for mod features
          </DialogTitle>
          <DialogDescription className="text-[var(--color-foreground-muted)] pt-2">
            This action needs additional permissions on your Twitch account.
            Click <strong>Reconnect</strong> to grant them — you'll be
            redirected through Twitch's login briefly.
          </DialogDescription>
        </DialogHeader>

        {missingScopes.length > 0 && (
          <ul className="py-4 space-y-2">
            {missingScopes.map((scope) => (
              <li
                key={scope}
                className="flex items-start gap-2 text-sm text-[var(--color-foreground)]"
                data-scope={scope}
              >
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[var(--color-storm-primary)] shrink-0" />
                <span>{SCOPE_DESCRIPTIONS[scope] ?? scope}</span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="pt-6 gap-2">
          <Button variant="outline" onClick={close} disabled={loading}>
            Not now
          </Button>
          <Button
            onClick={handleReconnect}
            disabled={loading}
            className="bg-[#9146FF] hover:bg-[#9146FF]/90 text-white"
          >
            {loading ? "Reconnecting…" : "Reconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
