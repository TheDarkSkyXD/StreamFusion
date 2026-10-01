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

type SavePreferences = {
  readonly enabled: boolean;
  readonly method: AdBlockMethod;
};

export function AdBlockSettingsPanel({
  session,
  onSaved,
}: {
  readonly session: AdBlockSession;
  readonly onSaved?: () => void;
}) {
  const [view, setView] = useState<AdBlockView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void session
      .load()
      .then(setView)
      .catch(() => setError("Could not load ad blocker settings."));
  }, [session]);
  return (
    <AdBlockSettingsView
      busy={busy}
      onSave={(next) => {
        setBusy(true);
        setError(null);
        void session
          .save(next)
          .then((saved) => {
            setView(saved);
            onSaved?.();
          })
          .catch(() =>
            setError("Could not save ad blocker settings. Try again."),
          )
          .finally(() => {
            setBusy(false);
          });
      }}
      error={error}
      view={view}
    />
  );
}

export function AdBlockSettingsView({
  busy,
  error,
  onSave,
  view,
}: {
  readonly busy: boolean;
  readonly error?: string | null;
  readonly onSave: (next: SavePreferences) => void;
  readonly view: AdBlockView | null;
}) {
  const enabled = view?.enabled ?? false;
  const method = view?.method ?? "strip";
  const locked =
    busy || view === null || !view.policyAllowed || !view.runtimeSupported;
  return (
    <View style={styles.panel} testID="panel-adblock">
      <AdBlockCopy view={view} />
      {error ? (
        <Text selectable style={styles.error} testID="adblock-error">
          {error}
        </Text>
      ) : null}
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

function AdBlockCopy({ view }: { readonly view: AdBlockView | null }) {
  return (
    <>
      <Text selectable style={styles.label}>
        CUSTOM TWITCH AD BLOCKER
      </Text>
      <Text selectable style={styles.title} testID="adblock-title">
        {view?.title ?? "Reading playback filtering."}
      </Text>
      <Text selectable style={styles.detail} testID="adblock-detail">
        {view?.detail ?? "Reading signed policy and the kill switch."}
      </Text>
      <Text selectable style={styles.detail} testID="adblock-twitch-support">
        When enabled in blocking mode, Twitch live playlists strip ad markers,
        use an ad-free backup during unsafe breaks, and hold playback when no
        safe stream is available.
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
      label="Custom Twitch ad blocker"
      onToggle={() => onSave({ enabled: !enabled, method })}
      testID="adblock"
    />
  );
}

const METHOD_CONTROLS = {
  canary: {
    accessibilityLabel: "Observe ads only with canary",
    label: "Observe ads only (canary)",
    testID: "adblock-method-canary",
  },
  strip: {
    accessibilityLabel: "Use Twitch ad blocker with backup",
    label: "Block Twitch ads with backup",
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
        {current === value ? `${control.label} selected` : control.label}
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
  error: {
    color: mobileColors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
