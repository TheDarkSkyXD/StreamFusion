import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SettingsSwitch } from "@mobile/features/settings/components/settings-controls";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  AdBlockMethod,
  AdBlockSession,
  AdBlockView,
} from "../capabilities/ad-blocking";
import type { TwitchPlaylistProxySession } from "../capabilities/twitch-playlist-proxy";

type SavePreferences = {
  readonly enabled: boolean;
  readonly method: AdBlockMethod;
};

export function AdBlockSettingsPanel({
  playlistProxySession,
  session,
}: {
  readonly playlistProxySession?: TwitchPlaylistProxySession;
  readonly session: AdBlockSession;
}) {
  const [view, setView] = useState<AdBlockView | null>(null);
  const [busy, setBusy] = useState(false);
  const [playlistProxyEnabled, setPlaylistProxyEnabled] = useState(false);
  useEffect(() => {
    void session.load().then(setView);
  }, [session]);
  useEffect(() => {
    if (!playlistProxySession) {
      return;
    }
    void playlistProxySession.snapshot().then((prefs) => {
      setPlaylistProxyEnabled(prefs.enabled);
    });
  }, [playlistProxySession]);
  const effectivePlaylistProxyEnabled = playlistProxySession
    ? playlistProxyEnabled
    : false;
  return (
    <AdBlockSettingsView
      busy={busy}
      onSave={(next) => {
        setBusy(true);
        void session
          .save(next)
          .then(setView)
          .finally(() => {
            setBusy(false);
          });
      }}
      playlistProxyEnabled={effectivePlaylistProxyEnabled}
      view={view}
    />
  );
}

export function AdBlockSettingsView({
  busy,
  onSave,
  playlistProxyEnabled = false,
  view,
}: {
  readonly busy: boolean;
  readonly onSave: (next: SavePreferences) => void;
  readonly playlistProxyEnabled?: boolean;
  readonly view: AdBlockView | null;
}) {
  const enabled = playlistProxyEnabled ? false : (view?.enabled ?? true);
  const method = view?.method ?? "strip";
  const locked = busy || view?.policyAllowed === false || playlistProxyEnabled;
  return (
    <View style={styles.panel} testID="panel-adblock">
      <AdBlockCopy playlistProxyEnabled={playlistProxyEnabled} view={view} />
      <FilterToggle
        busy={busy}
        enabled={enabled}
        locked={locked}
        method={method}
        onSave={onSave}
      />
      <MethodOption
        current={method}
        enabled={enabled}
        locked={locked}
        onSave={onSave}
        value="strip"
      />
      <MethodOption
        current={method}
        enabled={enabled}
        locked={locked}
        onSave={onSave}
        value="canary"
      />
    </View>
  );
}

function AdBlockCopy({
  playlistProxyEnabled,
  view,
}: {
  readonly playlistProxyEnabled: boolean;
  readonly view: AdBlockView | null;
}) {
  return (
    <>
      <Text selectable style={styles.label}>
        AD BLOCKING
      </Text>
      <Text selectable style={styles.title} testID="adblock-title">
        {playlistProxyEnabled
          ? "Custom ad blocker paused"
          : (view?.title ?? "Reading playback filtering.")}
      </Text>
      <Text selectable style={styles.detail} testID="adblock-detail">
        {playlistProxyEnabled
          ? "Twitch playlist proxy is enabled, so strip and canary stay paused. Your save is kept for when playlist proxy is turned off."
          : (view?.detail ?? "Reading signed policy and the kill switch.")}
      </Text>
      <Text selectable style={styles.detail} testID="adblock-twitch-support">
        Twitch live playlists can strip known ad markers inside the player.
      </Text>
      <Text selectable style={styles.detail} testID="adblock-kick-support">
        Kick has no approved filter. Playback stays unfiltered.
      </Text>
    </>
  );
}

function FilterToggle({
  busy,
  enabled,
  locked,
  method,
  onSave,
}: {
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly method: AdBlockMethod;
  readonly onSave: (next: SavePreferences) => void;
}) {
  return (
    <SettingsSwitch
      checked={enabled}
      disabled={locked || busy}
      label="Filtering"
      onToggle={() => onSave({ enabled: !enabled, method })}
      testID="adblock"
    />
  );
}

const METHOD_CONTROLS = {
  canary: {
    accessibilityLabel: "Use canary",
    testID: "adblock-method-canary",
  },
  strip: {
    accessibilityLabel: "Use playlist strip",
    testID: "adblock-method-strip",
  },
} as const;

function MethodOption({
  current,
  enabled,
  locked,
  onSave,
  value,
}: {
  readonly current: AdBlockMethod;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly onSave: (next: SavePreferences) => void;
  readonly value: AdBlockMethod;
}) {
  const control = METHOD_CONTROLS[value];
  return (
    <Pressable
      accessibilityLabel={control.accessibilityLabel}
      accessibilityRole="button"
      disabled={locked}
      onPress={() => onSave({ enabled, method: value })}
      style={styles.switchRow}
      testID={control.testID}
    >
      <Text selectable style={styles.switchLabel}>
        {current === value ? `Method: ${value}` : `Use ${value}`}
      </Text>
    </Pressable>
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
});
