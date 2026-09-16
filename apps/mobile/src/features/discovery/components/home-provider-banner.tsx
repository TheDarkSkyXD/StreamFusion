import { StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { PlatformReadOutcome } from "../capabilities/platform-reads";

export function HomeProviderBanner({
  onOpenAccounts,
  onRetry,
  outcome,
}: {
  readonly onOpenAccounts: () => void;
  readonly onRetry: (platform: Platform) => void;
  readonly outcome: PlatformReadOutcome<unknown>;
}) {
  const message = bannerMessage(outcome);
  if (message === null) return null;
  const canRetry = viewRetryable(outcome);
  return (
    <View style={styles.banner} testID={`home-banner-${outcome.platform}`}>
      <Text selectable style={styles.bannerCopy}>
        {message}
      </Text>
      {cacheAge(outcome) ? (
        <Text
          selectable
          style={styles.bannerCopy}
          testID={`home-cache-age-${outcome.platform}`}
        >
          {cacheAge(outcome)}
        </Text>
      ) : null}
      {canRetry ? (
        <MobileButton
          accessibilityLabel={`Retry ${outcome.platform}`}
          onPress={() => onRetry(outcome.platform)}
          testID={`home-retry-${outcome.platform}`}
          variant={outcome.platform}
        >
          {`Retry ${outcome.platform}`}
        </MobileButton>
      ) : outcome.error?.code === "auth-lost" ||
        (outcome.path.kind === "unavailable" &&
          outcome.path.reason === "signed-out-login-required") ? (
        <MobileButton
          accessibilityLabel={`Sign in to ${outcome.platform}`}
          onPress={onOpenAccounts}
          testID={`home-login-${outcome.platform}`}
          variant={outcome.platform}
        >
          Sign in
        </MobileButton>
      ) : null}
    </View>
  );
}

function bannerMessage(outcome: PlatformReadOutcome<unknown>): string | null {
  if (outcome.error?.code === "auth-lost") {
    return `${platformLabel(outcome.platform)} catalog can still use Relay.`;
  }
  if (outcome.error?.code === "cancelled") {
    return `${platformLabel(outcome.platform)} read was cancelled.`;
  }
  if (outcome.error?.code === "retry-exhausted") {
    return `${platformLabel(outcome.platform)} retries are exhausted. Retry this platform only.`;
  }
  if (
    outcome.path.kind === "unavailable" &&
    outcome.path.reason === "relay-unavailable"
  ) {
    return `${platformLabel(outcome.platform)} Relay is unavailable.`;
  }
  if (
    outcome.path.kind === "unavailable" &&
    outcome.path.reason === "signed-out-login-required"
  ) {
    return `${platformLabel(outcome.platform)} Relay is unavailable.`;
  }
  if (outcome.status === "failed") {
    return `${platformLabel(outcome.platform)} catalog read failed.`;
  }
  if (
    outcome.status === "stale" ||
    (outcome.cache.kind === "hit" && outcome.cache.stale)
  ) {
    return `${platformLabel(outcome.platform)} is showing a cached catalog.`;
  }
  return null;
}

function cacheAge(outcome: PlatformReadOutcome<unknown>): string | null {
  if (outcome.cache.kind !== "hit") return null;
  const minutes = Math.max(
    1,
    Math.round(outcome.cache.ageMilliseconds / 60_000),
  );
  return `Cached ${minutes} min ago`;
}

function viewRetryable(outcome: PlatformReadOutcome<unknown>): boolean {
  return (
    (outcome.error?.retry === "manual" ||
      outcome.error?.retry === "after" ||
      outcome.status === "failed" ||
      outcome.status === "partial") &&
    outcome.error?.code !== "cancelled"
  );
}

function platformLabel(platform: Platform): string {
  return platform === "twitch" ? "Twitch" : "Kick";
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  bannerCopy: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
});
