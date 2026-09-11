import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { KickFixtureCallbackKind } from "@mobile/features/auth/capabilities/kick-session";
import { shouldShowTwitchAvatar } from "@mobile/features/auth/components/account-avatar-state";
import type { KickAccountSessionSnapshot } from "@mobile/features/auth/domain/kick-account-session-controller";

export interface KickAccountActions {
  cancel(): void;
  connect(): void;
  disconnect(): void;
  injectFixture?(kind: KickFixtureCallbackKind): void;
  manage(): void;
  refresh(): void;
  retry(): void;
}

const fixtureKinds: readonly { kind: KickFixtureCallbackKind; label: string }[] = [
  { kind: "accepted", label: "Simulate Kick return" },
  { kind: "denied", label: "Simulate denial" },
  { kind: "expired", label: "Simulate expired return" },
  { kind: "stale", label: "Simulate stale return" },
  { kind: "duplicate", label: "Simulate duplicate return" },
  { kind: "state-mismatch", label: "Simulate state mismatch" },
  { kind: "wrong-redirect", label: "Simulate wrong redirect" },
  { kind: "superseded", label: "Simulate superseded return" },
];

export function KickAccountCard({
  actions,
  developmentFixture = false,
  model,
  onEnableDevelopmentFixture,
  onDisableDevelopmentFixture,
}: {
  readonly actions: KickAccountActions;
  readonly developmentFixture?: boolean;
  readonly model: KickAccountSessionSnapshot;
  readonly onEnableDevelopmentFixture?: (() => void) | undefined;
  readonly onDisableDevelopmentFixture?: (() => void) | undefined;
}) {
  return (
    <View style={styles.card} testID="kick-account-card">
      <Text accessibilityRole="header" style={styles.cardTitle}>
        Kick
      </Text>
      {developmentFixture ? (
        <View style={styles.fixtureRow}>
          <Text style={styles.fixture} testID="kick-development-fixture">
            Development fixture — not a live Kick account
          </Text>
          {onDisableDevelopmentFixture ? (
            <Action
              id="exit-development-kick-auth-fixture"
              label="Exit fixture"
              onPress={onDisableDevelopmentFixture}
            />
          ) : null}
        </View>
      ) : null}
      <KickState actions={actions} model={model} />
      {model.kind === "unavailable" && onEnableDevelopmentFixture ? (
        <Action
          id="development-kick-auth-fixture"
          label="Run development Kick auth fixture"
          onPress={onEnableDevelopmentFixture}
        />
      ) : null}
      {developmentFixture && actions.injectFixture && model.kind === "pending" ? (
        <View style={styles.actions}>
          {fixtureKinds.map((item) => (
            <Action
              id={`kick-fixture-${item.kind}`}
              key={item.kind}
              label={item.label}
              onPress={() => actions.injectFixture?.(item.kind)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function KickState({
  actions,
  model,
}: {
  readonly actions: KickAccountActions;
  readonly model: KickAccountSessionSnapshot;
}) {
  if (model.kind === "restoring")
    return <Status text="Restoring encrypted Kick account state…" />;
  if (model.kind === "unavailable")
    return (
      <>
        <Status text="Kick connection unavailable" />
        <Text style={styles.detail}>{model.guidance}</Text>
      </>
    );
  if (model.kind === "disconnected")
    return (
      <>
        <Status text={model.message ?? "Not connected"} />
        <Action id="connect-kick-account" label="Connect Kick" onPress={actions.connect} />
      </>
    );
  if (model.kind === "launching")
    return (
      <>
        <Status text="Opening Kick in the system browser…" />
        <Action id="cancel-kick-account-connect" label="Cancel" onPress={actions.cancel} />
      </>
    );
  if (model.kind === "pending")
    return (
      <>
        <Status text="Waiting for Kick authorization in the system browser" />
        <Text style={styles.detail}>
          Complete sign-in in the browser. This attempt expires{" "}
          {new Date(model.expiresAtEpochMs).toLocaleString()}.
        </Text>
        <Action id="cancel-kick-account-connect" label="Cancel" onPress={actions.cancel} />
      </>
    );
  if (model.kind === "validating" || model.kind === "committing")
    return (
      <Status
        text={
          model.kind === "validating"
            ? "Validating Kick authorization…"
            : "Saving encrypted Kick account state…"
        }
      />
    );
  if (model.kind === "failed")
    return (
      <>
        <Status text={model.message} />
        <Action
          id="retry-kick-account-connect"
          label={
            model.failure === "connection"
              ? "Retry Kick connection"
              : model.failure === "cancellation"
                ? "Retry cancellation"
                : "Retry loading Kick account state"
          }
          onPress={actions.retry}
        />
      </>
    );
  if (model.kind === "auth-lost")
    return (
      <>
        <Status
          text={`${model.displayName ?? "Kick account"} needs to reconnect: ${model.reason}`}
        />
        <Action
          id="retry-kick-account-connect"
          label="Reconnect Kick"
          onPress={actions.retry}
        />
      </>
    );
  if (model.kind !== "connected") return null;
  if (model.view === "confirm-disconnect")
    return (
      <>
        <Status
          text={`Disconnect Kick account ${model.displayName}? Only this Kick credential and session state will be removed. Guest Follows, History, Activity, settings, media, and other accounts stay intact.`}
        />
        <Action
          busy={model.refreshing}
          disabled={model.refreshing}
          id="disconnect-kick-account"
          label={
            model.refreshing
              ? `Disconnecting ${model.displayName}…`
              : `Confirm disconnect ${model.displayName}`
          }
          onPress={actions.disconnect}
        />
        <Action disabled={model.refreshing} label="Keep account" onPress={actions.manage} />
      </>
    );
  return (
    <>
      <View style={styles.identity}>
        <AccountAvatar
          displayName={model.displayName}
          key={model.profileImageUrl ?? "fallback"}
          profileImageUrl={model.profileImageUrl}
        />
        <View style={styles.identityCopy}>
          <Status text={`${model.displayName} (@${model.login}) · Kick`} />
        </View>
      </View>
      <Text style={styles.detail}>
        {model.missingScopes.length
          ? `Connected with limited features. Missing: ${model.missingScopes.join(", ")}`
          : "Connected. Required features are available."}
      </Text>
      {model.notice ? <Text style={styles.detail}>{model.notice}</Text> : null}
      {model.view === "manage" ? (
        <>
          <Text style={styles.detail}>
            Scopes: {model.scopes.join(", ") || "None"}
          </Text>
          <Text style={styles.detail}>
            Expires: {new Date(model.expiresAtEpochMs).toLocaleString()}
          </Text>
          <Action
            busy={model.refreshing}
            disabled={model.refreshing}
            id="manage-kick-account"
            label={model.refreshing ? "Refreshing…" : "Validate and refresh now"}
            onPress={actions.refresh}
          />
        </>
      ) : null}
      <View style={styles.actions}>
        {model.view === "manage" ? (
          <Action label="Close account details" onPress={actions.manage} />
        ) : (
          <Action id="manage-kick-account" label="Manage" onPress={actions.manage} />
        )}
        {model.view === "manage" ? (
          <Action
            id="disconnect-kick-account"
            label="Disconnect Kick"
            onPress={actions.disconnect}
          />
        ) : null}
      </View>
    </>
  );
}

function AccountAvatar({
  displayName,
  profileImageUrl,
}: {
  readonly displayName: string;
  readonly profileImageUrl: string | null;
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  if (shouldShowTwitchAvatar(profileImageUrl, failedImageUrl))
    return (
      <Image
        accessibilityLabel={`${displayName} Kick avatar`}
        onError={() => setFailedImageUrl(profileImageUrl)}
        source={{ uri: profileImageUrl }}
        style={styles.avatar}
      />
    );
  return (
    <View accessibilityLabel="Kick avatar fallback" style={styles.avatar}>
      <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function Status({ text }: { readonly text: string }) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.detail}>
      {text}
    </Text>
  );
}

function Action({
  busy = false,
  disabled = false,
  id,
  label,
  onPress,
}: {
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly id?: string;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      testID={id}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  actionText: { color: mobileColors.textPrimary, fontWeight: "700" },
  actions: { gap: mobileSpacing.small, marginTop: mobileSpacing.small },
  avatar: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    width: mobileSizing.minimumTouchTarget,
  },
  avatarText: { color: mobileColors.textPrimary, fontSize: 18, fontWeight: "800" },
  card: {
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.small,
    padding: mobileSpacing.large,
  },
  cardTitle: { color: mobileColors.textPrimary, fontSize: 18, fontWeight: "700" },
  detail: { color: mobileColors.textSecondary, lineHeight: 21 },
  disabled: { opacity: 0.5 },
  fixture: { color: mobileColors.live, fontWeight: "700" },
  fixtureRow: { gap: mobileSpacing.small },
  identity: { alignItems: "center", flexDirection: "row", gap: mobileSpacing.small },
  identityCopy: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
});
