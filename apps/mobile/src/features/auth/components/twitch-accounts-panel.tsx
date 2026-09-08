import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { TwitchAccountSessionSnapshot } from "@mobile/features/auth/domain/twitch-account-session-controller";
import { shouldShowTwitchAvatar } from "@mobile/features/auth/components/account-avatar-state";

export const TWITCH_ACCOUNT_CONTROL_IDS = [
  "connect-account",
  "manage-account",
  "disconnect-account",
  "copy-account-code",
  "open-account-verification",
  "cancel-account-connect",
  "retry-account-connect",
] as const;

export type TwitchAccountViewModel = TwitchAccountSessionSnapshot;

export interface TwitchAccountActions {
  cancel(): void;
  connect(): void;
  copyCode(): void;
  disconnect(): void;
  manage(): void;
  openVerification(): void;
  retry(): void;
  refresh(): void;
}

export function TwitchAccountsPanel({
  actions,
  developmentFixture = false,
  model,
  onEnableDevelopmentFixture,
  onDisableDevelopmentFixture,
  onOpenNotificationSettings,
}: {
  readonly actions: TwitchAccountActions;
  readonly developmentFixture?: boolean;
  readonly model: TwitchAccountViewModel;
  readonly onEnableDevelopmentFixture?: (() => void) | undefined;
  readonly onDisableDevelopmentFixture?: (() => void) | undefined;
  readonly onOpenNotificationSettings: () => void;
}) {
  return (
    <View style={styles.stack} testID="twitch-account-panel">
      <Text accessibilityRole="header" style={styles.title}>
        Accounts
      </Text>
      {developmentFixture ? (
        <View style={styles.fixtureRow}>
          <Text style={styles.fixture} testID="twitch-development-fixture">
            Development fixture — not a live Twitch account
          </Text>
          {onDisableDevelopmentFixture ? (
            <Action
              id="exit-development-twitch-auth-fixture"
              label="Exit fixture"
              onPress={onDisableDevelopmentFixture}
            />
          ) : null}
        </View>
      ) : null}
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Twitch
        </Text>
        <TwitchState actions={actions} model={model} />
        {model.kind === "unavailable" && onEnableDevelopmentFixture ? (
          <Action
            id="development-twitch-auth-fixture"
            label="Run development auth fixture"
            onPress={onEnableDevelopmentFixture}
          />
        ) : null}
      </View>
      <AccountCard
        title="Kick"
        detail="Kick account connection is not available yet."
      />
      <AccountCard
        title="Guest mode"
        detail="Public browsing and Guest Follows stay available on this device."
      />
      <AccountCard
        title="Account notifications"
        detail="Status: not configured here. Notification delivery is managed by Notifications in Settings. Twitch connection does not change Guest Follow eligibility."
      />
      <Action
        id="account-live-alerts"
        label="Open Settings"
        onPress={onOpenNotificationSettings}
      />
    </View>
  );
}

function TwitchState({
  actions,
  model,
}: {
  readonly actions: TwitchAccountActions;
  readonly model: TwitchAccountViewModel;
}) {
  if (model.kind === "restoring")
    return <Status text="Restoring encrypted account state…" />;
  if (model.kind === "unavailable")
    return (
      <>
        <Status text="Twitch connection unavailable" />
        <Text style={styles.detail}>{model.guidance}</Text>
      </>
    );
  if (model.kind === "disconnected")
    return (
      <>
        <Status text={model.message ?? "Not connected"} />
        <Action
          id="connect-account"
          label="Connect Twitch"
          onPress={actions.connect}
        />
      </>
    );
  if (model.kind === "requesting")
    return (
      <>
        <Status text="Requesting a secure Device Code…" />
        <Action
          id="cancel-account-connect"
          label="Cancel"
          onPress={actions.cancel}
        />
      </>
    );
  if (model.kind === "pending")
    return (
      <>
        <Status
          text={
            model.status === "offline"
              ? "Offline. Waiting to retry safely."
              : "Waiting for Twitch authorization"
          }
        />
        <Text selectable style={styles.code}>
          {model.code}
        </Text>
        <Text selectable style={styles.detail}>
          {model.verificationUri}
        </Text>
        <Text style={styles.detail}>
          Code valid until {new Date(model.expiresAtEpochMs).toLocaleString()}
        </Text>
        {model.feedback ? <Status text={model.feedback} /> : null}
        <View style={styles.actions}>
          <Action
            id="copy-account-code"
            label="Copy code"
            onPress={actions.copyCode}
          />
          <Action
            id="open-account-verification"
            label="Open verification page"
            onPress={actions.openVerification}
          />
          <Action
            id="cancel-account-connect"
            label="Cancel"
            onPress={actions.cancel}
          />
        </View>
      </>
    );
  if (model.kind === "validating" || model.kind === "committing")
    return (
      <Status
        text={
          model.kind === "validating"
            ? "Validating Twitch identity…"
            : "Saving encrypted account state…"
        }
      />
    );
  if (model.kind === "failed")
    return (
      <>
        <Status text={model.message} />
        <Action
          id="retry-account-connect"
          label={
            model.failure === "connection"
              ? "Retry connection"
              : model.failure === "cancellation"
                ? "Retry cancellation"
                : "Retry loading account state"
          }
          onPress={actions.retry}
        />
      </>
    );
  if (model.kind === "auth-lost")
    return (
      <>
        <Status
          text={`${model.displayName ?? "Twitch account"} needs to reconnect: ${model.reason}`}
        />
        <Action
          id="retry-account-connect"
          label="Reconnect Twitch"
          onPress={actions.retry}
        />
      </>
    );
  if (model.view === "confirm-disconnect")
    return (
      <>
        <Status
          text={`Disconnect Twitch account ${model.displayName}? Only this Twitch credential and session state will be removed. Guest Follows, History, Activity, settings, media, and other accounts stay intact.`}
        />
        <Action
          busy={model.refreshing}
          disabled={model.refreshing}
          id="disconnect-account"
          label={
            model.refreshing
              ? `Disconnecting ${model.displayName}…`
              : `Confirm disconnect ${model.displayName}`
          }
          onPress={actions.disconnect}
        />
        <Action
          disabled={model.refreshing}
          label="Keep account"
          onPress={actions.manage}
        />
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
          <Status text={`${model.displayName} (@${model.login}) · Twitch`} />
        </View>
      </View>
      <Text style={styles.detail}>
        {model.missingScopes.length
          ? `Connected with limited features. Missing: ${model.missingScopes.join(", ")}`
          : "Connected. Required features are available."}
      </Text>
      <Text style={styles.detail}>
        Account permissions available: {model.scopes.includes("chat:read") ? "read Twitch chat metadata" : "basic identity only"}.
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
          <Text style={styles.detail}>
            Last validated:{" "}
            {new Date(model.validatedAtEpochMs).toLocaleString()}
          </Text>
          <Action
            busy={model.refreshing}
            disabled={model.refreshing}
            id="manage-account"
            label={
              model.refreshing
                ? "Validating and refreshing…"
                : "Validate and refresh now"
            }
            onPress={actions.refresh}
          />
        </>
      ) : null}
      <View style={styles.actions}>
        {model.view === "manage" ? (
          <Action label="Close account details" onPress={actions.manage} />
        ) : (
          <Action
            id="manage-account"
            label="Manage"
            onPress={actions.manage}
          />
        )}
        {model.view === "manage" ? (
          <Action
            id="disconnect-account"
            label="Disconnect Twitch"
            onPress={actions.disconnect}
          />
        ) : null}
      </View>
    </>
  );
}

function AccountCard({
  detail,
  title,
}: {
  readonly detail: string;
  readonly title: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
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
        accessibilityLabel={`${displayName} Twitch avatar`}
        onError={() => setFailedImageUrl(profileImageUrl)}
        source={{ uri: profileImageUrl }}
        style={styles.avatar}
      />
    );
  return (
    <View accessibilityLabel="Twitch avatar fallback" style={styles.avatar}>
      <Text style={styles.avatarText}>
        {displayName.slice(0, 1).toUpperCase()}
      </Text>
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
  card: {
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.small,
    padding: mobileSpacing.large,
  },
  cardTitle: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  avatar: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    width: mobileSizing.minimumTouchTarget,
  },
  avatarText: { color: mobileColors.textPrimary, fontSize: 18, fontWeight: "800" },
  code: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 3,
  },
  detail: { color: mobileColors.textSecondary, lineHeight: 21 },
  fixture: { color: mobileColors.live, fontWeight: "700" },
  fixtureRow: { gap: mobileSpacing.small },
  identity: { alignItems: "center", flexDirection: "row", gap: mobileSpacing.small },
  identityCopy: { flex: 1, minWidth: 0 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  stack: { gap: mobileSpacing.medium, paddingBottom: mobileSpacing.xLarge },
  title: { color: mobileColors.textPrimary, fontSize: 24, fontWeight: "800" },
});
