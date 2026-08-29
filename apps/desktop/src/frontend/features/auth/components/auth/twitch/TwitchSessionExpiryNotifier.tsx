import { useEffect } from "react";
import { toast } from "sonner";

import { useAuthStore } from "@/store/auth-store";

export function TwitchSessionExpiryNotifier() {
  const initialized = useAuthStore((state) => state.initialized);
  const reconnectRequired = useAuthStore((state) => state.twitchReconnectRequired);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);

  useEffect(() => {
    if (!initialized || !reconnectRequired) return;

    toast.error("Signed out of Twitch", {
      id: "twitch-session-expired",
      description: "Your Twitch session expired. Reconnect to use chat and account features.",
      duration: 10_000,
      action: {
        label: "Reconnect",
        onClick: loginTwitch,
      },
    });
  }, [initialized, loginTwitch, reconnectRequired]);

  return null;
}
