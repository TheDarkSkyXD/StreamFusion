import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

const PROXY_SETTING_KEY = "proxy.v1";

export function createProxyPreferenceStore(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): {
  read(): Promise<string | null>;
  write(input: {
    readonly enabled: boolean;
    readonly host: string;
    readonly port: number | null;
  }): Promise<void>;
} {
  const now = input.now ?? Date.now;
  return {
    read() {
      return input.settings.read(PROXY_SETTING_KEY);
    },
    write(value) {
      return input.settings.write(
        PROXY_SETTING_KEY,
        JSON.stringify({
          enabled: value.enabled,
          host: value.host,
          port: value.port,
          version: 1,
        }),
        now(),
      );
    },
  };
}
