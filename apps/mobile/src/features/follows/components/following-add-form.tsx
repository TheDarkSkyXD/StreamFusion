import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { findGuestFollow, type GuestFollow } from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileTextField } from "@mobile/design/text-input";
import { mobileColors, mobileSpacing } from "@mobile/design/tokens";

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
      <MobileTextField
        label={t("discovery.following.channelLogin")}
        autoCapitalize="none"
        autoCorrect={false}
        onChange={setLogin}
        placeholder={t("discovery.following.channelLoginPlaceholder")}
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
  if (
    findGuestFollow(input.membership, {
      channelLogin,
      platform: input.platform,
    })
  ) {
    input.setMessage(input.t("discovery.following.alreadyGuestFollow"));
    return;
  }
  input.setBusy(true);
  let result: Awaited<ReturnType<FollowingSession["mutateFollow"]>>;
  try {
    result = await input.session.mutateFollow({ channelLogin, platform: input.platform });
  } catch {
    input.setMessage("Could not save Guest Follow. Try again.");
    return;
  } finally {
    input.setBusy(false);
  }
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
  row: { flexDirection: "row", gap: mobileSpacing.small },
  message: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
