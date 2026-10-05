import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MobileButton } from "@mobile/design/button";
import { MobileTextField } from "@mobile/design/text-input";

import { SettingsSwitch } from "@mobile/features/settings/components/settings-controls";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  ConnectivitySession,
  ConnectivityView,
  ProxyDraft,
} from "../capabilities/connectivity-session";
import { emptyProxyDraft } from "../domain/compose-connectivity-view";

export function ProxySettingsPanel({
  session,
}: {
  readonly session: ConnectivitySession;
}) {
  const [view, setView] = useState<ConnectivityView | null>(null);
  const [draft, setDraft] = useState<ProxyDraft>(emptyProxyDraft);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void session.load().then((next) => {
      setView(next);
      setDraft(next.draft);
    });
  }, [session]);
  return (
    <ProxySettingsView
      busy={busy}
      draft={draft}
      onChange={setDraft}
      onSave={() => {
        setBusy(true);
        void session
          .saveDraft(draft)
          .then((next) => {
            setView(next);
            setDraft(next.draft);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
      view={view}
    />
  );
}

export function ProxySettingsView({
  busy,
  draft,
  onChange,
  onSave,
  view,
}: {
  readonly busy: boolean;
  readonly draft: ProxyDraft;
  readonly onChange: (draft: ProxyDraft) => void;
  readonly onSave: () => void;
  readonly view: ConnectivityView | null;
}) {
  return (
    <View style={styles.panel} testID="panel-proxy">
      <Text selectable style={styles.label}>
        PROXY AND CONNECTIVITY
      </Text>
      <Text selectable style={styles.title} testID="proxy-network-status">
        {view === null
          ? "Checking connectivity"
          : view.network === "offline"
            ? "Offline"
            : "Online"}
      </Text>
      <Text selectable style={styles.detail} testID="proxy-network-detail">
        {view?.networkDetail ?? "Reading network status."}
      </Text>
      <Text selectable style={styles.detail} testID="proxy-request-scope">
        Discovery and Following requests use this proxy. Playback playlist
        routing has separate controls.
      </Text>
      <SettingsSwitch
        checked={draft.enabled}
        disabled={busy}
        label="Proxy"
        onToggle={() => onChange({ ...draft, enabled: !draft.enabled })}
        testID="proxy-enabled"
      />
      <MobileTextField
        label="Proxy host"
        autoCapitalize="none"
        autoCorrect={false}
        disabled={busy}
        onChange={(host) => onChange({ ...draft, host })}
        placeholder="127.0.0.1"
        testID="proxy-host"
        value={draft.host}
      />
      <MobileTextField
        label="Proxy port"
        autoCapitalize="none"
        autoCorrect={false}
        disabled={busy}
        keyboardType="number-pad"
        onChange={(portText) => onChange({ ...draft, portText })}
        placeholder="8080"
        testID="proxy-port"
        value={draft.portText}
      />
      <MobileTextField
        label="Proxy username"
        autoCapitalize="none"
        autoCorrect={false}
        disabled={busy}
        onChange={(username) => onChange({ ...draft, username })}
        placeholder="username (optional)"
        testID="proxy-username"
        value={draft.username}
      />
      <MobileTextField
        label="Proxy password"
        autoCapitalize="none"
        autoCorrect={false}
        disabled={busy}
        onChange={(password) => onChange({ ...draft, password })}
        placeholder="password (optional)"
        secure
        testID="proxy-password"
        value={draft.password}
      />
      <MobileButton
        accessibilityLabel="Save proxy"
        busy={busy}
        disabled={busy}
        onPress={onSave}
        testID="proxy-save"
        variant="primary"
      >
        Save proxy
      </MobileButton>
      {view?.parse.kind === "invalid" ? (
        <Text selectable style={styles.detail} testID="proxy-save-detail">
          {view.parse.reason}
        </Text>
      ) : view?.saveDetail ? (
        <Text selectable style={styles.detail} testID="proxy-save-detail">
          {view.saveDetail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  detail: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
});
