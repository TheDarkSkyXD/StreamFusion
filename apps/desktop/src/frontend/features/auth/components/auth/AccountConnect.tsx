import { LuExternalLink, LuPower } from "react-icons/lu";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { getPlatformColor } from "@/assets/platforms";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useKickAuth, useTwitchAuth } from "@/features/auth/data/useAuth";
import type { Platform, PlatformUser } from "@shared/auth-types";
import type { TwitchAuthPhase } from "@/store/auth-store";

function twitchLoadingLabel(phase: TwitchAuthPhase, t: TFunction): string {
  switch (phase) {
    case "opening":
      return t("auth.openingTwitch");
    case "waiting":
      return t("auth.waitingTwitch");
    case "finishing":
      return t("auth.finishingTwitch");
    default:
      return t("auth.connecting");
  }
}

/**
 * AccountConnect Component
 *
 * Displays cards for connecting/disconnecting platform accounts.
 */
export function AccountConnect() {
  const { t } = useTranslation();
  const twitch = useTwitchAuth();
  const kick = useKickAuth();

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <PlatformCard
        platform="twitch"
        connected={twitch.connected}
        user={twitch.user}
        loading={twitch.loading}
        loadingLabel={twitchLoadingLabel(twitch.authPhase, t)}
        onConnect={twitch.login}
        onDisconnect={twitch.logout}
      />

      <PlatformCard
        platform="kick"
        connected={kick.connected}
        user={kick.user}
        loading={kick.loading}
        onConnect={kick.login}
        onDisconnect={kick.logout}
      />
    </div>
  );
}

interface PlatformCardProps {
  platform: Platform;
  connected: boolean;
  user: PlatformUser | null;
  loading: boolean;
  loadingLabel?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  disabled?: boolean;
  message?: string;
}

function PlatformCard({
  platform,
  connected,
  user,
  loading,
  loadingLabel,
  onConnect,
  onDisconnect,
  disabled,
  message,
}: PlatformCardProps) {
  const { t } = useTranslation();
  const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
  const color = getPlatformColor(platform);
  const displayName = user ? ("displayName" in user ? user.displayName : user.username) : undefined;
  const profileImageUrl = user
    ? "profileImageUrl" in user
      ? user.profileImageUrl
      : user.profilePic
    : undefined;

  return (
    <Card
      className={`overflow-hidden border-l-4 transition-all duration-300 ${connected ? "border-l-[color:var(--border-color)]" : "border-l-[color:var(--border-color)]"}`}
      style={{ borderLeftColor: connected ? color : undefined }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-xl">
            {platform === "twitch" && <TwitchIcon size={24} className="text-[#9146FF]" />}
            {platform === "kick" && <KickIcon size={24} className="text-[#53FC18]" />}
            {platformName}
          </CardTitle>
          {connected && (
            <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
              </span>
              {t("auth.connected")}
            </div>
          )}
        </div>
        <CardDescription>
          {connected
            ? t("auth.connectedAs", { user: displayName ?? t("auth.user") })
            : t("auth.connectAccountDescription", { platform: platformName })}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {connected ? (
          (() => {
            const initial = (displayName || "?").charAt(0).toUpperCase();

            // Custom fallback with platform color
            const fallbackElement = (
              <div
                className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold"
                style={{
                  backgroundColor: color,
                  color: platform === "kick" ? "black" : "white",
                }}
              >
                {initial}
              </div>
            );

            return (
              <div className="flex items-center gap-3">
                <ProxiedImage
                  src={profileImageUrl}
                  alt={displayName || t("auth.user")}
                  className="h-12 w-12 rounded-full border border-border object-cover"
                  fallback={fallbackElement}
                />
                <div className="flex flex-col">
                  <span className="font-semibold">{displayName}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {t("auth.platformUser", { platform })}
                  </span>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="flex h-12 items-center text-sm text-muted-foreground">
            {message || t("auth.accessFollowed")}
          </div>
        )}
      </CardContent>

      <CardFooter className="bg-secondary/50 px-6 py-4">
        {connected ? (
          <div className="w-full">
            <Button
              variant="destructive"
              size="sm"
              onClick={onDisconnect}
              disabled={loading}
              className="w-full gap-2"
            >
              <LuPower className="h-4 w-4" />
              {loading ? t("auth.disconnecting") : t("auth.disconnect")}
            </Button>
          </div>
        ) : (
          <Button
            style={{
              backgroundColor: disabled ? undefined : color,
              color: platform === "kick" ? "black" : "white",
              ["--hover-bg" as string]: platform === "kick" ? "#3FC912" : undefined,
            }}
            className={`w-full gap-2 transition-all duration-200 ${
              platform === "kick"
                ? "hover:!bg-[#3FC912] hover:scale-[1.02] hover:shadow-lg hover:shadow-[#53FC18]/30"
                : "hover:brightness-110"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={disabled ? undefined : onConnect}
            disabled={loading || disabled}
          >
            {loading
              ? (loadingLabel ?? t("auth.connecting"))
              : t("auth.connectWith", { platform: platformName })}
            {!loading && !disabled && <LuExternalLink className="h-4 w-4" />}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
