import type { KickAccountSessionSnapshot } from "@mobile/features/auth/domain/kick-account-session-controller";
import type { TwitchAccountSessionSnapshot } from "@mobile/features/auth/domain/twitch-account-session-controller";

import { integrationsSummary } from "../domain/api-token-status";
import {
  SettingsAction,
  SettingsCopy,
  SettingsSection,
} from "./settings-controls";

export function IntegrationsSettingsPanel({
  kick,
  onOpenAccounts,
  twitch,
}: {
  readonly kick: KickAccountSessionSnapshot;
  readonly onOpenAccounts: () => void;
  readonly twitch: TwitchAccountSessionSnapshot;
}) {
  return (
    <IntegrationsSettingsView
      kick={kick}
      onOpenAccounts={onOpenAccounts}
      twitch={twitch}
    />
  );
}

export function IntegrationsSettingsView({
  kick,
  onOpenAccounts,
  twitch,
}: {
  readonly kick: KickAccountSessionSnapshot;
  readonly onOpenAccounts: () => void;
  readonly twitch: TwitchAccountSessionSnapshot;
}) {
  const guest =
    twitch.kind === "disconnected" && kick.kind === "disconnected";
  return (
    <SettingsSection testID="panel-integrations" title="INTEGRATIONS">
      <SettingsCopy
        testID="integrations-disclosure"
        value={
          guest
            ? "Sign in required to connect Twitch or Kick. Guest mode stays read-only."
            : "Manage connected Twitch and Kick accounts. Sign-in flows open on Accounts."
        }
      />
      <SettingsCopy
        testID="integrations-twitch"
        value={`Twitch: ${integrationsSummary(twitch)}`}
      />
      <SettingsCopy
        testID="integrations-kick"
        value={`Kick: ${integrationsSummary(kick)}`}
      />
      <SettingsAction
        label={guest ? "Sign in on Accounts" : "Open Accounts"}
        onPress={onOpenAccounts}
        testID="integrations-accounts"
      />
    </SettingsSection>
  );
}
