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
  readonly registrationCopy?: () => Promise<string>;
  readonly store: LiveNotificationPreferenceStore;
}): NotificationSettingsSession {
  const listeners = new Set<() => void>();
  let cached = defaultNotificationSettingsView();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function hydrate(
    snapshot?: NotificationPermissionSnapshot,
  ): Promise<NotificationSettingsView> {
    const [preferences, permission, network, registrationCopy] = await Promise.all([
      input.store.read(),
      Promise.resolve(snapshot ?? input.permission.read()),
      input.network(),
      input.registrationCopy?.() ?? Promise.resolve(undefined),
    ]);
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
      return () => {
        listeners.delete(listener);
      };
    },
    load: () => hydrate(),
    async apply(patch: NotificationPreferencePatch) {
      const permission = await (patch.enabled === true
        ? input.permission.request()
        : input.permission.read());
      await input.store.write(
        mergeNotificationPreferences(cached.preferences, patch),
      );
      return hydrate(permission);
    },
    retryPermission: async () => hydrate(await input.permission.request()),
    openSystemSettings: () => input.permission.openSystemSettings(),
  };
}
