import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { findGuestFollow, type GuestFollow } from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import {
  mobileTextFieldProps,
  mobileTextFieldStyle,
} from "@mobile/design/text-field";
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
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [login, setLogin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.stack} testID="following-add-form">
      <Text selectable style={styles.heading}>
        {t("discovery.following.addGuestFollow")}
      </Text>
      <View style={styles.row}>
        {(["twitch", "kick"] as const).map((value) => (
          <MobileFilterChip
            accessibilityLabel={t("discovery.following.addGuestOnPlatform", {
              platform: value,
            })}
            key={value}
            label={value}
            onPress={() => setPlatform(value)}
            selected={platform === value}
            testID={`following-add-platform-${value}`}
          />
        ))}
      </View>
      <TextInput
        {...mobileTextFieldProps}
        accessibilityLabel={t("discovery.following.channelLogin")}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setLogin}
        placeholder={t("discovery.following.channelLoginPlaceholder")}
        placeholderTextColor={mobileColors.textMuted}
        style={styles.input}
        testID="following-add-login"
        value={login}
      />
      <MobileButton
        accessibilityLabel={t("discovery.following.followAsGuest")}
        disabled={busy}
        onPress={() => {
          const translate = (key: string, values?: Record<string, unknown>) =>
            values === undefined ? t(key) : t(key, values);
          void addFollow({
            login,
            membership,
            onAdded,
            platform,
            session,
            setBusy,
            setMessage,
            t: translate,
          });
        }}
        testID="following-add-submit"
        variant="primary"
      >
        {t("discovery.following.followAsGuest")}
      </MobileButton>
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
  readonly t: (key: string, values?: Record<string, unknown>) => string;
}): Promise<void> {
  const channelLogin = input.login.trim().toLowerCase();
  if (channelLogin.length === 0) {
    input.setMessage(input.t("discovery.following.enterChannelLogin"));
    return;
  }
  if (findGuestFollow(input.membership, { channelLogin, platform: input.platform })) {
    input.setMessage(input.t("discovery.following.alreadyGuestFollow"));
    return;
  }
  input.setBusy(true);
  const result = await input.session.mutateFollow({
    channelLogin,
    platform: input.platform,
  });
  input.setBusy(false);
  if (result.kind === "followed") {
    input.setMessage(
      input.t("discovery.following.followingAsGuest", {
        name: result.follow.displayName,
      }),
    );
    input.onAdded();
    return;
  }
  input.setMessage(
    result.kind === "rejected" && result.reason === "unresolved-channel"
      ? input.t("discovery.following.channelNotFound")
      : input.t("discovery.following.guestSignedInBlocked"),
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
  input: {
    ...mobileTextFieldStyle,
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  message: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
