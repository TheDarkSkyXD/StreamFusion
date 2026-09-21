import type { KickAccountSessionSnapshot } from "@mobile/features/auth/domain/kick-account-session-controller";
import type { TwitchAccountSessionSnapshot } from "@mobile/features/auth/domain/twitch-account-session-controller";

import type {
  ApiTokenPlatformView,
  ApiTokenSettingsView,
} from "../capabilities/api-token-settings";
import { composeApiTokenSettingsView } from "../domain/api-token-status";
import {
  SettingsAction,
  SettingsCopy,
  SettingsSection,
} from "./settings-controls";

export function ApiTokensSettingsPanel({
  kick,
  onOpenIntegrations,
  twitch,
}: {
  readonly kick: KickAccountSessionSnapshot;
  readonly onOpenIntegrations: () => void;
  readonly twitch: TwitchAccountSessionSnapshot;
}) {
  return (
    <ApiTokensSettingsView
      onOpenIntegrations={onOpenIntegrations}
      view={composeApiTokenSettingsView({ kick, twitch })}
    />
  );
}

export function ApiTokensSettingsView({
  onOpenIntegrations,
  view,
}: {
  readonly onOpenIntegrations: () => void;
  readonly view: ApiTokenSettingsView;
}) {
  return (
    <SettingsSection testID="panel-api-tokens" title="API AND TOKENS">
      <SettingsCopy testID="api-token-disclosure" value={view.disclosure} />
      <PlatformTokenCard platform={view.twitch} />
      <PlatformTokenCard platform={view.kick} />
      <SettingsAction
        label="Connect in Integrations"
        onPress={onOpenIntegrations}
        testID="api-token-status"
      />
    </SettingsSection>
  );
}

function PlatformTokenCard({
  platform,
}: {
  readonly platform: ApiTokenPlatformView;
}) {
  const status = platform.status;
  let detail = "Checking…";
  if (status.kind === "not-connected") detail = "Not signed in";
  if (status.kind === "invalid") detail = status.reason;
  if (status.kind === "valid") {
    const expiry = new Date(status.expiresAtEpochMs).toLocaleString();
    const scopes =
      status.scopes.length > 0 ? status.scopes.join(", ") : "none reported";
    detail = `Valid · ${status.login} · expires ${expiry} · scopes: ${scopes}`;
  }
  return (
    <SettingsCopy
      testID={`api-token-${platform.platform}`}
      value={`${platform.label}: ${detail}`}
    />
  );
}
