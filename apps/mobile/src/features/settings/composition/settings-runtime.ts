import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import {
  DEFAULT_PRODUCT_PREFERENCES,
  applyPreferencePatch,
  type PreferencePatch,
} from "@streamfusion/core/settings";
import { resolveDisplayLanguage } from "@streamfusion/core/display-language";

import type { SettingsSession, SettingsView } from "../capabilities/settings";
import { createProductPreferenceStore } from "../data/settings-store";
import { composeSettingsView } from "../domain/settings-view";
import { applyAppearanceScheme } from "../adapters/appearance-scheme";
import { activateDisplayLanguage } from "@mobile/i18n";

export function createSettingsSession(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
  readonly streamDeviceId?: string;
}): SettingsSession {
  const store = createProductPreferenceStore(input);
  const listeners = new Set<() => void>();
  let cached = DEFAULT_PRODUCT_PREFERENCES;
  let query = "";
  let rejected: readonly string[] = [];
  applyAppearanceScheme();

  function view(): SettingsView {
    return composeSettingsView({
      preferences: cached,
      query,
      rejected,
      streamDeviceId: input.streamDeviceId ?? "unavailable",
    });
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function syncLanguage(): Promise<void> {
    await activateDisplayLanguage(resolveDisplayLanguage(cached.language));
  }

  async function hydrate(): Promise<void> {
    cached = await store.read();
    applyAppearanceScheme();
    await syncLanguage();
  }

  return {
    snapshot: () => cached,
    peek: view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async read() {
      await hydrate();
      return cached;
    },
    async load() {
      await hydrate();
      rejected = [];
      notify();
      return view();
    },
    async search(nextQuery) {
      query = nextQuery;
      notify();
      return view();
    },
    async apply(patch: PreferencePatch) {
      const applied = applyPreferencePatch(cached, patch);
      cached = applied.preferences;
      rejected = applied.rejected;
      applyAppearanceScheme();
      await store.write(cached);
      if (patch.language !== undefined) {
        await syncLanguage();
      }
      notify();
      return applied;
    },
  };
}
