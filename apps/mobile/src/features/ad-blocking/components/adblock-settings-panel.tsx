import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
}: {
  readonly session: AdBlockSession;
}) {
  const [view, setView] = useState<AdBlockView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void session.load().then(setView);
  }, [session]);
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
      view={view}
    />
  );
}

export function AdBlockSettingsView({
  busy,
  onSave,
  view,
}: {
  readonly busy: boolean;
  readonly onSave: (next: SavePreferences) => void;
  readonly view: AdBlockView | null;
}) {
  const enabled = view?.enabled ?? true;
  const method = view?.method ?? "strip";
  const locked = busy || view?.policyAllowed === false;
  return (
    <View style={styles.panel} testID="panel-adblock">
      <AdBlockCopy view={view} />
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
        AD BLOCKING
      </Text>
      <Text selectable style={styles.title} testID="adblock-title">
        {view?.title ?? "Reading playback filtering."}
      </Text>
      <Text selectable style={styles.detail} testID="adblock-detail">
        {view?.detail ?? "Reading signed policy and the kill switch."}
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
    <Pressable
      accessibilityLabel={enabled ? "Disable ad blocking" : "Enable ad blocking"}
      accessibilityRole="switch"
      accessibilityState={{ busy, checked: enabled }}
      disabled={locked}
      onPress={() => onSave({ enabled: !enabled, method })}
      style={styles.switchRow}
      testID="adblock"
    >
      <Text selectable style={styles.switchLabel}>
        {enabled ? "Filtering on" : "Filtering off"}
      </Text>
    </Pressable>
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
