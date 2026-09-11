import { useEffect, useState } from "react";
import { AppState } from "react-native";

import type { KickAccountSessionController } from "@mobile/features/auth/domain/kick-account-session-controller";
import type { KickFixtureCallbackKind } from "@mobile/features/auth/capabilities/kick-session";

export function useKickAccountController(options: {
  readonly controller: KickAccountSessionController;
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
      disconnect: () => void options.controller.disconnect(),
      ...(options.controller.injectFixture
        ? {
            injectFixture: (kind: KickFixtureCallbackKind) =>
              void options.controller.injectFixture?.(kind),
          }
        : {}),
      manage: () => options.controller.manage(),
      refresh: () => void options.controller.refresh(),
      retry: () => void options.controller.retry(),
    },
  };
}
