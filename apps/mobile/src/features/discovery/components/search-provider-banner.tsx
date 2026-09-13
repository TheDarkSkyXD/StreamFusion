import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
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
        <Pressable
          accessibilityLabel={`Retry ${outcome.platform}`}
          accessibilityRole="button"
          android_ripple={{ color: mobileColors.surfaceRaised }}
          onPress={() => onRetry(outcome.platform)}
          style={({ pressed }) => [
            styles.retry,
            pressed ? styles.pressed : null,
          ]}
          testID={`search-retry-${outcome.platform}`}
        >
          <Text selectable style={styles.retryLabel}>
            {`Retry ${outcome.platform}`}
          </Text>
        </Pressable>
      ) : showLogin ? (
        <Pressable
          accessibilityLabel={`Sign in to ${outcome.platform}`}
          accessibilityRole="button"
          onPress={onOpenAccounts}
          style={({ pressed }) => [
            styles.retry,
            pressed ? styles.pressed : null,
          ]}
          testID={`search-login-${outcome.platform}`}
        >
          <Text selectable style={styles.retryLabel}>
            Sign in
          </Text>
        </Pressable>
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
  retry: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  retryLabel: {
    color: mobileColors.background,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.76,
  },
});
