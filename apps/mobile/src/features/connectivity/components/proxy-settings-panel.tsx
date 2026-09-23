import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SettingsSwitch } from "@mobile/features/settings/components/settings-controls";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
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
        {view?.network === "offline" ? "Offline" : "Online"}
      </Text>
      <Text selectable style={styles.detail} testID="proxy-network-detail">
        {view?.networkDetail ?? "Reading network status."}
      </Text>
      <Text selectable style={styles.detail} testID="proxy-request-scope">
        Discovery and Following requests use this proxy. Playback playlists are
        not routed until Watch exists.
      </Text>
      <SettingsSwitch
        checked={draft.enabled}
        disabled={busy}
        label="Proxy"
        onToggle={() => onChange({ ...draft, enabled: !draft.enabled })}
        testID="proxy-enabled"
      />
      <TextInput
        accessibilityLabel="Proxy host"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(host) => onChange({ ...draft, host })}
        placeholder="127.0.0.1"
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.input}
        testID="proxy-host"
        value={draft.host}
      />
      <TextInput
        accessibilityLabel="Proxy port"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        keyboardType="number-pad"
        onChangeText={(portText) => onChange({ ...draft, portText })}
        placeholder="8080"
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.input}
        testID="proxy-port"
        value={draft.portText}
      />
      <TextInput
        accessibilityLabel="Proxy username"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(username) => onChange({ ...draft, username })}
        placeholder="username (optional)"
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.input}
        testID="proxy-username"
        value={draft.username}
      />
      <TextInput
        accessibilityLabel="Proxy password"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(password) => onChange({ ...draft, password })}
        placeholder="password (optional)"
        placeholderTextColor={mobileColors.textSecondary}
        secureTextEntry
        style={styles.input}
        testID="proxy-password"
        value={draft.password}
      />
      <Pressable
        accessibilityLabel="Save proxy"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onSave}
        style={styles.save}
        testID="proxy-save"
      >
        <Text selectable style={styles.saveLabel}>
          Save proxy
        </Text>
      </Pressable>
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
  switchRow: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  switchLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  input: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    color: mobileColors.textPrimary,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  save: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  saveLabel: {
    color: mobileColors.background,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
});
