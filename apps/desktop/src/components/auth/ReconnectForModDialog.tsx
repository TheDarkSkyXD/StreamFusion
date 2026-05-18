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

export function ReconnectForModDialog() {
  const isOpen = useReconnectDialogStore((state) => state.isOpen);
  const close = useReconnectDialogStore((state) => state.close);
  const logoutTwitch = useAuthStore((state) => state.logoutTwitch);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loading = useAuthStore((state) => state.twitchLoading);

  const handleReconnect = async () => {
    close();
    try {
      await logoutTwitch();
      await loginTwitch();
    } catch (error) {
      // Login flow surfaces its own error UI via useAuthStore.error; nothing
      // to add here.
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
            Pinning and unpinning Twitch messages from StreamForge requires
            additional permissions. Click <strong>Reconnect</strong> to grant
            them — you'll be redirected through Twitch's login briefly.
          </DialogDescription>
        </DialogHeader>

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
