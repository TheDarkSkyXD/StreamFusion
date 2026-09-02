import { Link, useNavigate } from "@tanstack/react-router";
import { Tv, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IoMdSettings } from "react-icons/io";

import { ProxiedImage } from "@/components/ui/proxied-image";
import { useAuthStatus, useUserInfo } from "@/features/auth/data/useAuth";
import { useAuthStore } from "@/store/auth-store";
import { DisplayLanguageSelect } from "@/components/settings/DisplayLanguageSelect";
import { resolveDisplayLanguage } from "@/i18n";

const kickMenuItemClass =
  "flex h-12 w-full items-center gap-4 px-4 py-1 text-left text-base font-normal leading-6 text-white transition-colors hover:bg-[var(--color-background-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]";
const kickMenuIconClass = "h-4 w-4 shrink-0 text-white";
const settingsMenuIconClass = "h-[18px] w-[18px] shrink-0 text-white";

function KickLogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M16 7H12.38L14.19 5.19L12.78 3.78L8.55 8L12.78 12.22L14.19 10.81L12.38 9H16V7Z" />
      <path d="M7 14H4V2H7V4H9V0H0V16H9V12H7V14Z" />
    </svg>
  );
}

// Stacked Avatar Component for multi-platform
function StackedAvatars({
  twitchAvatar,
  kickAvatar,
  twitchName,
  kickName,
  size = "sm",
}: {
  twitchAvatar?: string | null;
  kickAvatar?: string | null;
  twitchName?: string;
  kickName?: string;
  size?: "sm" | "md";
}) {
  const dimensions = size === "sm" ? "w-7 h-7" : "w-9 h-9";
  const offset = size === "sm" ? "translate-x-3" : "translate-x-4";
  const containerWidth = size === "sm" ? "w-10" : "w-12";

  return (
    <div className={`relative ${containerWidth} h-8 flex items-center`}>
      {/* Kick avatar (behind) */}
      <div className={`absolute ${offset} z-0`}>
        <ProxiedImage
          src={kickAvatar}
          alt={kickName || "Kick"}
          className={`${dimensions} rounded-full ring-2 ring-[#53FC18] shadow-md`}
          fallback={
            <div
              className={`${dimensions} rounded-full bg-[#53FC18]/20 ring-2 ring-[#53FC18] flex items-center justify-center shadow-md`}
            >
              <span className="text-[#53FC18] text-xs font-bold">K</span>
            </div>
          }
        />
      </div>
      {/* Twitch avatar (front) */}
      <div className="absolute z-10">
        <ProxiedImage
          src={twitchAvatar}
          alt={twitchName || "Twitch"}
          className={`${dimensions} rounded-full ring-2 ring-[#9146FF] shadow-md`}
          fallback={
            <div
              className={`${dimensions} rounded-full bg-[#9146FF]/20 ring-2 ring-[#9146FF] flex items-center justify-center shadow-md`}
            >
              <span className="text-[#9146FF] text-xs font-bold">T</span>
            </div>
          }
        />
      </div>
    </div>
  );
}

// Single Platform Avatar
function SingleAvatar({
  avatar,
  name,
  platform,
  size = "sm",
}: {
  avatar?: string | null;
  name?: string;
  platform: "twitch" | "kick";
  size?: "sm" | "md";
}) {
  const dimensions = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  const ringColor = platform === "twitch" ? "ring-[#9146FF]" : "ring-[#53FC18]";
  const bgColor = platform === "twitch" ? "bg-[#9146FF]/20" : "bg-[#53FC18]/20";
  const textColor = platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]";

  const fallbackElement = (
    <div
      className={`${dimensions} rounded-full ${bgColor} ring-2 ${ringColor} flex items-center justify-center`}
    >
      <span className={`${textColor} text-xs font-bold`}>{platform[0].toUpperCase()}</span>
    </div>
  );

  // Both platforms go through ProxiedImage: Kick CDN needs the kick-image://
  // proxy for Referer/Origin spoofing, and Twitch CDN occasionally 403s on
  // specific profile-image objects — ProxiedImage's onError → fallback path
  // handles both cleanly, where a raw <img> would show a broken-image icon.
  return (
    <ProxiedImage
      src={avatar}
      alt={name || platform}
      className={`${dimensions} rounded-full ring-2 ${ringColor}`}
      fallback={fallbackElement}
    />
  );
}

export function ProfileDropdown() {
  const { t } = useTranslation();
  const { displayName, hasAnyUser, twitchUser, kickUser } = useUserInfo();
  const { twitch, kick } = useAuthStatus();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const logoutTwitch = useAuthStore((state) => state.logoutTwitch);
  const logoutKick = useAuthStore((state) => state.logoutKick);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loginKick = useAuthStore((state) => state.loginKick);
  const preferences = useAuthStore((state) => state.preferences);
  const updatePreferences = useAuthStore((state) => state.updatePreferences);

  const bothConnected = twitch.connected && kick.connected;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-display-language-options]")
      ) {
        return;
      }
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDisconnectTwitch = async () => {
    await logoutTwitch();
  };

  const handleDisconnectKick = async () => {
    await logoutKick();
  };

  const handleLogoutAll = async () => {
    await Promise.all([logoutTwitch(), logoutKick()]);
    setIsOpen(false);
  };

  const handleOpenTwitchChannel = () => {
    if (!twitchUser?.login) return;
    navigate({
      to: "/stream/$platform/$channel",
      params: { platform: "twitch", channel: twitchUser.login },
      search: { tab: "home" },
    });
    setIsOpen(false);
  };

  const handleOpenKickChannel = () => {
    const channelSlug = kickUser?.slug || kickUser?.username;
    if (!channelSlug) return;
    navigate({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: channelSlug },
      search: { tab: "home" },
    });
    setIsOpen(false);
  };

  // Render the avatar button based on connection state
  const renderAvatarButton = () => {
    if (bothConnected) {
      return (
        <StackedAvatars
          twitchAvatar={twitchUser?.profileImageUrl}
          kickAvatar={kickUser?.profilePic}
          twitchName={twitchUser?.displayName}
          kickName={kickUser?.username}
          size="sm"
        />
      );
    }

    if (twitch.connected && twitchUser) {
      return (
        <SingleAvatar
          avatar={twitchUser.profileImageUrl}
          name={twitchUser.displayName}
          platform="twitch"
          size="sm"
        />
      );
    }

    if (kick.connected && kickUser) {
      return (
        <SingleAvatar
          avatar={kickUser.profilePic}
          name={kickUser.username}
          platform="kick"
          size="sm"
        />
      );
    }

    return (
      <div className="w-8 h-8 rounded-full bg-[var(--color-background-tertiary)] flex items-center justify-center">
        <User size={16} className="text-[var(--color-foreground-secondary)]" />
      </div>
    );
  };

  // Render the avatar in dropdown header
  const renderDropdownAvatar = () => {
    if (bothConnected) {
      return (
        <StackedAvatars
          twitchAvatar={twitchUser?.profileImageUrl}
          kickAvatar={kickUser?.profilePic}
          twitchName={twitchUser?.displayName}
          kickName={kickUser?.username}
          size="md"
        />
      );
    }

    if (twitch.connected && twitchUser) {
      return (
        <SingleAvatar
          avatar={twitchUser.profileImageUrl}
          name={twitchUser.displayName}
          platform="twitch"
          size="md"
        />
      );
    }

    if (kick.connected && kickUser) {
      return (
        <SingleAvatar
          avatar={kickUser.profilePic}
          name={kickUser.username}
          platform="kick"
          size="md"
        />
      );
    }

    return (
      <div className="w-10 h-10 rounded-full bg-[var(--color-background-tertiary)] flex items-center justify-center">
        <User size={20} className="text-[var(--color-foreground-secondary)]" />
      </div>
    );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-1 py-1 rounded-full hover:bg-[var(--color-background-secondary)] transition-colors outline-none"
        type="button"
        aria-label={t("profile.open")}
        aria-expanded={isOpen}
      >
        {renderAvatarButton()}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-[318px] rounded-md border border-[var(--color-border)] bg-[var(--color-background-elevated)] p-2 shadow-[0_4px_16px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)] z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--color-border)] mb-1 flex items-center gap-4">
            {renderDropdownAvatar()}
            <div className="flex flex-col overflow-hidden">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                {!hasAnyUser && (
                  <span className="inline-flex items-center rounded-full bg-[var(--color-background-tertiary)] text-[var(--color-foreground-muted)] text-xs px-1.5 py-0.5 font-medium">
                    {t("profile.guest")}
                  </span>
                )}
              </div>
              {!hasAnyUser && (
                <p className="text-xs text-[var(--color-foreground-muted)] mt-0.5">
                  {t("profile.guestPrompt")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-0.5">
            {/* Connected Accounts Section */}
            {hasAnyUser && (
              <>
                <div className="px-4 py-1.5">
                  <p className="text-xs font-medium text-[var(--color-foreground-muted)] uppercase tracking-wider">
                    {t("profile.connectedAccounts")}
                  </p>
                </div>

                {/* Twitch Account */}
                {twitch.connected && twitchUser ? (
                  <div className="flex h-12 items-center justify-between px-4 py-1 bg-[var(--color-background-secondary)]/50 group">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <ProxiedImage
                          src={twitchUser.profileImageUrl}
                          alt={twitchUser.displayName}
                          className="w-7 h-7 rounded-full ring-2 ring-[#9146FF]"
                          fallback={
                            <div className="w-7 h-7 rounded-full bg-[#9146FF]/20 ring-2 ring-[#9146FF] flex items-center justify-center">
                              <span className="text-[#9146FF] text-xs font-bold">T</span>
                            </div>
                          }
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm text-white font-medium">
                          {twitchUser.displayName}
                        </span>
                        <span className="text-xs text-[#9146FF]">Twitch</span>
                      </div>
                    </div>
                    <button
                      onClick={handleDisconnectTwitch}
                      className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all"
                      title={t("profile.disconnectTwitch")}
                    >
                      <X size={18} strokeWidth={3} className="text-red-400" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      loginTwitch();
                      setIsOpen(false);
                    }}
                    className={`${kickMenuItemClass} hover:bg-[#9146FF]/20`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 shrink-0 text-[#9146FF]"
                      fill="currentColor"
                    >
                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                    </svg>
                    <span>{t("profile.connectTwitch")}</span>
                  </button>
                )}

                {/* Kick Account */}
                {kick.connected && kickUser ? (
                  <div className="flex h-12 items-center justify-between px-4 py-1 bg-[var(--color-background-secondary)]/50 group">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <ProxiedImage
                          src={kickUser.profilePic}
                          alt={kickUser.username}
                          className="w-7 h-7 rounded-full ring-2 ring-[#53FC18]"
                          fallback={
                            <div className="w-7 h-7 rounded-full bg-[#53FC18]/20 ring-2 ring-[#53FC18] flex items-center justify-center">
                              <span className="text-[#53FC18] text-xs font-bold">K</span>
                            </div>
                          }
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm text-white font-medium">{kickUser.username}</span>
                        <span className="text-xs text-[#53FC18]">Kick</span>
                      </div>
                    </div>
                    <button
                      onClick={handleDisconnectKick}
                      className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all"
                      title={t("profile.disconnectKick")}
                    >
                      <X size={18} strokeWidth={3} className="text-red-400" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      loginKick();
                      setIsOpen(false);
                    }}
                    className={`${kickMenuItemClass} hover:bg-[#53FC18]/20`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 shrink-0 text-[#53FC18]"
                      fill="currentColor"
                    >
                      <path d="M9 3a1 1 0 0 1 1 1v3h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h6a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-1v1a1 1 0 0 1 -.883 .993l-.117 .007h-1v2h1a1 1 0 0 1 .993 .883l.007 .117v1h1a1 1 0 0 1 .993 .883l.007 .117v4a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-1h-1a1 1 0 0 1 -.993 -.883l-.007 -.117v-1h-1v3a1 1 0 0 1 -.883 .993l-.117 .007h-5a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z" />
                    </svg>
                    <span>{t("profile.connectKick")}</span>
                  </button>
                )}

                <div className="my-1.5 border-t border-[var(--color-border)]" />
              </>
            )}

            {/* Connect Account options for guests (no accounts connected) */}
            {!hasAnyUser && (
              <>
                <button
                  onClick={() => {
                    loginTwitch();
                    setIsOpen(false);
                  }}
                  className={`${kickMenuItemClass} hover:bg-[#9146FF]/20`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-[#9146FF]"
                    fill="currentColor"
                  >
                    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                  </svg>
                  {t("profile.connectTwitch")}
                </button>
                <button
                  onClick={() => {
                    loginKick();
                    setIsOpen(false);
                  }}
                  className={`${kickMenuItemClass} hover:bg-[#53FC18]/20`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-[#53FC18]"
                    fill="currentColor"
                  >
                    <path d="M9 3a1 1 0 0 1 1 1v3h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h6a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-1v1a1 1 0 0 1 -.883 .993l-.117 .007h-1v2h1a1 1 0 0 1 .993 .883l.007 .117v1h1a1 1 0 0 1 .993 .883l.007 .117v4a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-1h-1a1 1 0 0 1 -.993 -.883l-.007 -.117v-1h-1v3a1 1 0 0 1 -.883 .993l-.117 .007h-5a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z" />
                  </svg>
                  {t("profile.connectKick")}
                </button>
                <div className="my-1 border-t border-[var(--color-border)]" />
              </>
            )}

            {twitch.connected && twitchUser?.login && (
              <button onClick={handleOpenTwitchChannel} className={kickMenuItemClass}>
                <Tv className={settingsMenuIconClass} size={18} />
                {bothConnected ? t("profile.twitchChannel") : t("profile.channel")}
              </button>
            )}

            {kick.connected && (kickUser?.slug || kickUser?.username) && (
              <button onClick={handleOpenKickChannel} className={kickMenuItemClass}>
                <Tv className={settingsMenuIconClass} size={18} />
                {bothConnected ? t("profile.kickChannel") : t("profile.channel")}
              </button>
            )}

            <Link to="/settings" className={kickMenuItemClass} onClick={() => setIsOpen(false)}>
              <IoMdSettings className={settingsMenuIconClass} size={18} />
              {t("profile.settings")}
            </Link>

            {preferences && (
              <div className="px-4 py-3 border-t border-[var(--color-border)]">
                <label
                  className="mb-2 block text-xs font-medium text-[var(--color-foreground-muted)]"
                  htmlFor="profile-display-language"
                >
                  {t("profile.displayLanguage")}
                </label>
                <DisplayLanguageSelect
                  id="profile-display-language"
                  value={resolveDisplayLanguage(preferences.language)}
                  onChange={(language) => void updatePreferences({ language })}
                />
              </div>
            )}

            {hasAnyUser && (
              <button onClick={handleLogoutAll} className={kickMenuItemClass}>
                <KickLogoutIcon className={kickMenuIconClass} />
                {t("profile.logout")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
