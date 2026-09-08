import { useEffect, useState } from "react";
import { AppState } from "react-native";

import type { TwitchAccountSessionController } from "@mobile/features/auth/domain/twitch-account-session-controller";

export function useTwitchAccountController(options: {
  readonly controller: TwitchAccountSessionController;
  readonly enabled?: boolean;
}) {
  const [model, setModel] = useState(options.controller.getSnapshot);

  useEffect(() => {
    if (options.enabled === false) return;
    const unsubscribe = options.controller.subscribe(() =>
      setModel(options.controller.getSnapshot()),
    );
    options.controller.setForeground(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      options.controller.setForeground(state === "active"),
    );
    return () => {
      subscription.remove();
      unsubscribe();
      options.controller.setForeground(false);
    };
  }, [options.controller, options.enabled]);

  return {
    model,
    actions: {
      cancel: () => void options.controller.cancel(),
      connect: () => void options.controller.connect(),
      copyCode: () => void options.controller.copyCode(),
      disconnect: () => void options.controller.disconnect(),
      manage: () => options.controller.manage(),
      openVerification: () => void options.controller.openVerification(),
      refresh: () => void options.controller.refresh(),
      retry: () => void options.controller.retry(),
    },
  };
}
