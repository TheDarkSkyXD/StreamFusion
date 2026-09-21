import { StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { SearchReadOutcome } from "../capabilities/platform-reads";

export function SearchProviderBanner({
  onOpenAccounts,
  onRetry,
  outcome,
}: {
  readonly onOpenAccounts: () => void;
  readonly onRetry: (platform: Platform) => void;
  readonly outcome: SearchReadOutcome;
}) {
  const message = bannerMessage(outcome);
  if (message === null) return null;
  const canRetry = viewRetryable(outcome);
  const showLogin =
    outcome.error?.code === "auth-lost" &&
    outcome.path.kind === "unavailable" &&
    outcome.path.reason === "auth-lost";
  return (
    <View style={styles.banner} testID={`search-banner-${outcome.platform}`}>
      <Text selectable style={styles.bannerCopy}>
        {message}
      </Text>
      {cacheAge(outcome) ? (
        <Text
          selectable
          style={styles.bannerCopy}
          testID={`search-cache-age-${outcome.platform}`}
        >
          {cacheAge(outcome)}
        </Text>
      ) : null}
      {canRetry ? (
        <MobileButton
          accessibilityLabel={`Retry ${outcome.platform}`}
          onPress={() => onRetry(outcome.platform)}
          testID={`search-retry-${outcome.platform}`}
          variant={outcome.platform}
        >
          {`Retry ${outcome.platform}`}
        </MobileButton>
      ) : showLogin ? (
        <MobileButton
          accessibilityLabel={`Sign in to ${outcome.platform}`}
          onPress={onOpenAccounts}
          testID={`search-login-${outcome.platform}`}
          variant={outcome.platform}
        >
          Sign in
        </MobileButton>
      ) : null}
    </View>
  );
}

function bannerMessage(outcome: SearchReadOutcome): string | null {
  if (outcome.error?.code === "guest-unavailable") {
    return `${platformLabel(outcome.platform)} guest search needs Relay. Kick and cached results stay available.`;
  }
  if (outcome.error?.code === "auth-lost") {
    return `${platformLabel(outcome.platform)} sign-in was lost. Guest search still runs.`;
  }
  if (outcome.error?.code === "cancelled") {
    return `${platformLabel(outcome.platform)} search was cancelled.`;
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
  if (outcome.status === "failed") {
    return `${platformLabel(outcome.platform)} search failed.`;
  }
  if (
    outcome.status === "stale" ||
    (outcome.cache.kind === "hit" && outcome.cache.stale)
  ) {
    return `${platformLabel(outcome.platform)} is showing a cached catalog.`;
  }
  return null;
}

function cacheAge(outcome: SearchReadOutcome): string | null {
  if (outcome.cache.kind !== "hit") return null;
  const minutes = Math.max(
    1,
    Math.round(outcome.cache.ageMilliseconds / 60_000),
  );
  return `Cached ${minutes} min ago`;
}

function viewRetryable(outcome: SearchReadOutcome): boolean {
  return (
    (outcome.error?.retry === "manual" ||
      outcome.error?.retry === "after" ||
      outcome.status === "failed" ||
      outcome.status === "partial") &&
    outcome.error?.code !== "auth-lost" &&
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
