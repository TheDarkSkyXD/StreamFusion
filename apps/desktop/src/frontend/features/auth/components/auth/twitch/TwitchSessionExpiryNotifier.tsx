import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAuthStore } from "@/store/auth-store";

export function TwitchSessionExpiryNotifier() {
  const { t } = useTranslation();
  const initialized = useAuthStore((state) => state.initialized);
  const reconnectRequired = useAuthStore((state) => state.twitchReconnectRequired);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);

  useEffect(() => {
    if (!initialized || !reconnectRequired) return;

    toast.error(t("auth.signedOutTwitch"), {
      id: "twitch-session-expired",
      description: t("auth.twitchExpired"),
      duration: 10_000,
      action: {
        label: t("auth.reconnect"),
        onClick: loginTwitch,
      },
    });
  }, [initialized, loginTwitch, reconnectRequired, t]);

  return null;
}
