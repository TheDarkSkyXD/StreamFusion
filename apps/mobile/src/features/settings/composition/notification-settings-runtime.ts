import type { LiveNotificationPreferenceStore } from "@mobile/features/storage/capabilities/persistence";

import type {
  NotificationNetwork,
  NotificationPermissionPort,
  NotificationPermissionSnapshot,
  NotificationPreferencePatch,
  NotificationSettingsSession,
  NotificationSettingsView,
} from "../capabilities/notification-settings";
import {
  composeNotificationSettingsView,
  defaultNotificationSettingsView,
  mergeNotificationPreferences,
} from "../domain/notification-status";

export function createNotificationSettingsSession(input: {
  readonly network: () => Promise<NotificationNetwork>;
  readonly permission: NotificationPermissionPort;
  readonly onLocalChange?: () => void;
  readonly registrationCopy?: () => string;
  readonly registrationSubscribe?: (listener: () => void) => () => void;
  readonly store: LiveNotificationPreferenceStore;
}): NotificationSettingsSession {
  const listeners = new Set<() => void>();
  let cached = defaultNotificationSettingsView();
  let unsubscribeRegistration: (() => void) | null = null;

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function hydrate(
    snapshot?: NotificationPermissionSnapshot,
  ): Promise<NotificationSettingsView> {
    const [preferences, permission, network] = await Promise.all([
      input.store.read(),
      Promise.resolve(snapshot ?? input.permission.read()),
      input.network(),
    ]);
    const registrationCopy = input.registrationCopy?.();
    cached = composeNotificationSettingsView({
      apiLevel: permission.apiLevel,
      network,
      permission: permission.permission,
      preferences,
      ...(registrationCopy === undefined ? {} : { registrationCopy }),
    });
    notify();
    return cached;
  }

  return {
    peek: () => cached,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && input.registrationSubscribe) {
        unsubscribeRegistration = input.registrationSubscribe(() => {
          const registrationCopy = input.registrationCopy?.();
          if (registrationCopy === undefined) return;
          cached = { ...cached, registrationCopy };
          notify();
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeRegistration?.();
          unsubscribeRegistration = null;
        }
      };
    },
    load: () => hydrate(),
    async apply(patch: NotificationPreferencePatch) {
      const shouldRequest =
        patch.enabled === true || patch.guestFollows === true;
      const permission = await (shouldRequest
        ? input.permission.request()
        : input.permission.read());
      await input.store.write(
        mergeNotificationPreferences(cached.preferences, patch),
      );
      input.onLocalChange?.();
      return hydrate(permission);
    },
    async retryPermission() {
      const permission = await input.permission.request();
      input.onLocalChange?.();
      return hydrate(permission);
    },
    openSystemSettings: () => input.permission.openSystemSettings(),
  };
}
