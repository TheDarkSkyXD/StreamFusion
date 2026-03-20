import { LuLayoutTemplate, LuMessageSquare } from "react-icons/lu";

import { getPlatformColor } from "@/assets/platforms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useKickAuth, useTwitchAuth } from "@/hooks/useAuth";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const twitch = useTwitchAuth();
  const kick = useKickAuth();

  const handleTwitchLogin = async () => {
    await twitch.login();
    // Dialog will close if auth state changes or we can close it manually
    onOpenChange(false);
  };

  const handleKickLogin = async () => {
    await kick.login();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[var(--color-background-elevated)] border-[var(--color-border)]">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl font-bold text-white">
            Welcome to StreamFusion
          </DialogTitle>
          <DialogDescription className="text-center text-[var(--color-foreground-muted)]">
            Connect your accounts to access all features
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <Button
            className="w-full gap-2 text-white h-12 text-lg font-semibold hover:brightness-110 transition-all"
            style={{ backgroundColor: getPlatformColor("twitch") }}
            onClick={handleTwitchLogin}
            disabled={twitch.loading}
          >
            {/* Twitch Icon would go here */}
            <LuMessageSquare className="h-5 w-5 fill-current" />
            Continue with Twitch
          </Button>

          <Button
            className="w-full gap-2 text-white h-12 text-lg font-semibold hover:brightness-110 transition-all opacity-50 cursor-not-allowed" // Disabled for now
            style={{ backgroundColor: getPlatformColor("kick") }}
            onClick={handleKickLogin}
            disabled={true /* kick.loading || true */}
          >
            {/* Kick Icon would go here */}
            <LuLayoutTemplate className="h-5 w-5 fill-current" />
            Continue with Kick (Coming Soon)
          </Button>

          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[var(--color-border)]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[var(--color-background-elevated)] px-2 text-[var(--color-foreground-muted)]">
                Or continue as guest
              </span>
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-full text-[var(--color-foreground-secondary)] hover:text-white"
            onClick={() => onOpenChange(false)}
          >
            Skip for now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
