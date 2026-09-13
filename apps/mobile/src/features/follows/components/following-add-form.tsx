import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { findGuestFollow, type GuestFollow } from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { FollowingSession } from "../capabilities/following-session";

export function FollowingAddForm({
  membership,
  onAdded,
  session,
}: {
  readonly membership: readonly GuestFollow[];
  readonly onAdded: () => void;
  readonly session: FollowingSession;
}) {
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [login, setLogin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.stack} testID="following-add-form">
      <Text selectable style={styles.heading}>
        Add a Guest Follow
      </Text>
      <View style={styles.row}>
        {(["twitch", "kick"] as const).map((value) => (
          <Pressable
            accessibilityRole="button"
            key={value}
            onPress={() => setPlatform(value)}
            style={[styles.chip, platform === value ? styles.selected : null]}
            testID={`following-add-platform-${value}`}
          >
            <Text selectable style={styles.chipLabel}>
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Channel login"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setLogin}
        placeholder="channel login"
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.input}
        testID="following-add-login"
        value={login}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          void addFollow({
            login,
            membership,
            onAdded,
            platform,
            session,
            setBusy,
            setMessage,
          });
        }}
        style={styles.submit}
        testID="following-add-submit"
      >
        <Text selectable style={styles.submitLabel}>
          Follow as guest
        </Text>
      </Pressable>
      {message ? (
        <Text selectable style={styles.message} testID="following-add-message">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

async function addFollow(input: {
  readonly login: string;
  readonly membership: readonly GuestFollow[];
  readonly onAdded: () => void;
  readonly platform: Platform;
  readonly session: FollowingSession;
  readonly setBusy: (busy: boolean) => void;
  readonly setMessage: (message: string) => void;
}): Promise<void> {
  const channelLogin = input.login.trim().toLowerCase();
  if (channelLogin.length === 0) {
    input.setMessage("Enter a channel login.");
    return;
  }
  if (findGuestFollow(input.membership, { channelLogin, platform: input.platform })) {
    input.setMessage("That channel is already a Guest Follow.");
    return;
  }
  input.setBusy(true);
  const result = await input.session.mutateFollow({
    channelLogin,
    platform: input.platform,
  });
  input.setBusy(false);
  if (result.kind === "followed") {
    input.setMessage(`Following ${result.follow.displayName} as a guest.`);
    input.onAdded();
    return;
  }
  input.setMessage(
    result.kind === "rejected" && result.reason === "unresolved-channel"
      ? "That channel could not be found."
      : "Guest Follows cannot use a signed-in account.",
  );
}

const styles = StyleSheet.create({
  stack: { gap: mobileSpacing.small },
  heading: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  row: { flexDirection: "row", gap: mobileSpacing.small },
  chip: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  selected: { backgroundColor: mobileColors.navigationSelected },
  chipLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  input: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    color: mobileColors.textPrimary,
    fontSize: 16,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  submit: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  submitLabel: {
    color: mobileColors.background,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  message: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
