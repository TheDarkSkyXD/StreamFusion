import type {
  ProductSettingsStore,
  SecureSecretStore,
} from "@mobile/features/storage/capabilities/persistence";

import { createProxyFetch, nativeProxyAvailability } from "../adapters/native-proxy-fetch";
import { readExpoNetwork } from "../adapters/expo-network-source";
import type {
  ConnectivitySession,
  ConnectivityView,
  NetworkRead,
  ProxyDraft,
  ProxyTransport,
} from "../capabilities/connectivity-session";
import { composeConnectivityView } from "../domain/compose-connectivity-view";
import { parseProxyDraft } from "../domain/proxy-config";
import { createProxyCredentialStore } from "../data/proxy-credential-store";
import { createProxyPreferenceStore } from "../data/proxy-preference-store";

export function createConnectivityRuntime(input: {
  readonly now?: () => number;
  readonly readNetwork?: () => Promise<NetworkRead>;
  readonly secrets: SecureSecretStore;
  readonly settings: ProductSettingsStore;
}): ConnectivitySession {
  const preferences = createProxyPreferenceStore({
    now: input.now ?? Date.now,
    settings: input.settings,
  });
  const credentials = createProxyCredentialStore({ secrets: input.secrets });
  const readNetwork = input.readNetwork ?? readExpoNetwork;

  async function snapshot(saveDetail: string | null = null): Promise<ConnectivityView> {
    const [stored, secret, network] = await Promise.all([
      preferences.read(),
      credentials.read(),
      readNetwork(),
    ]);
    return composeConnectivityView({
      credentials: secret,
      nativeProxy: nativeProxyAvailability(),
      network,
      saveDetail,
      stored,
    });
  }

  async function currentTransport(): Promise<ProxyTransport> {
    const view = await snapshot();
    return view.proxy;
  }

  const fetch = createProxyFetch({
    readCredentials: () => credentials.read(),
    readTransport: currentTransport,
  });

  return {
    fetch,
    load: () => snapshot(),
    readNetwork,
    async saveDraft(draft: ProxyDraft): Promise<ConnectivityView> {
      const parsed = parseProxyDraft(draft);
      if (parsed.kind === "invalid") {
        const [stored, secret, network] = await Promise.all([
          preferences.read(),
          credentials.read(),
          readNetwork(),
        ]);
        return composeConnectivityView({
          credentials: secret,
          draft,
          nativeProxy: nativeProxyAvailability(),
          network,
          saveDetail: parsed.reason,
          stored,
        });
      }
      const enabled = parsed.kind === "ready";
      await preferences.write({
        enabled,
        host: parsed.kind === "ready" ? parsed.host : draft.host.trim(),
        port: parsed.kind === "ready" ? parsed.port : null,
      });
      await credentials.write(
        draft.username.trim() === "" && draft.password === ""
          ? null
          : {
              password: draft.password,
              username: draft.username.trim(),
            },
      );
      return snapshot("Proxy settings saved.");
    },
  };
}
