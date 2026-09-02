/**
 * Guest Mode Components
 *
 * UI components and utilities for guest mode functionality.
 * - Guest badge indicator
 * - Feature gating
 * - Login prompts
 */

import type React from "react";
import type { TFunction } from "i18next";
import { LuLock, LuLogIn, LuUser } from "react-icons/lu";
import { useTranslation } from "react-i18next";

import { useAuthStore } from "@/store/auth-store";

// ========== Guest Badge ==========

interface GuestBadgeProps {
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  className?: string;
}

/**
 * Badge that indicates the user is in guest mode
 */
export function GuestBadge({ size = "md", showIcon = true, className = "" }: GuestBadgeProps) {
  const { t } = useTranslation();
  const isGuest = useAuthStore((state) => state.isGuest);

  if (!isGuest) return null;

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5 gap-1",
    md: "text-sm px-2 py-1 gap-1.5",
    lg: "text-base px-3 py-1.5 gap-2",
  };

  const iconSizes = {
    sm: 10,
    md: 12,
    lg: 14,
  };

  return (
    <span
      className={`inline-flex items-center rounded-full bg-[var(--color-background-tertiary)] text-[var(--color-foreground-muted)] font-medium ${sizeClasses[size]} ${className}`}
    >
      {showIcon && <LuUser size={iconSizes[size]} />}
      {t("auth.guest")}
    </span>
  );
}

// ========== Feature Gating ==========

/**
 * Features that require authentication
 */
export type GatedFeature =
  | "chat:send"
  | "chat:moderate"
  | "follow:sync"
  | "follow:platform"
  | "channel-points"
  | "subscriptions"
  | "predictions"
  | "polls"
  | "clips:create"
  | "notifications:live";

/**
 * Feature descriptions for login prompts
 */
type FeatureTranslationKey =
  | "auth.sendChatMessages"
  | "auth.moderateChat"
  | "auth.syncFollows"
  | "auth.followOnPlatform"
  | "auth.channelPoints"
  | "auth.subscriptions"
  | "auth.predictions"
  | "auth.polls"
  | "auth.createClips"
  | "auth.liveNotifications"
  | "auth.featureDescriptions.chatSend"
  | "auth.featureDescriptions.chatModerate"
  | "auth.featureDescriptions.followSync"
  | "auth.featureDescriptions.followPlatform"
  | "auth.featureDescriptions.channelPoints"
  | "auth.featureDescriptions.subscriptions"
  | "auth.featureDescriptions.predictions"
  | "auth.featureDescriptions.polls"
  | "auth.featureDescriptions.clipsCreate"
  | "auth.featureDescriptions.notificationsLive";

const featureDescriptions: Record<
  GatedFeature,
  { title: FeatureTranslationKey; description: FeatureTranslationKey }
> = {
  "chat:send": {
    title: "auth.sendChatMessages",
    description: "auth.featureDescriptions.chatSend",
  },
  "chat:moderate": {
    title: "auth.moderateChat",
    description: "auth.featureDescriptions.chatModerate",
  },
  "follow:sync": {
    title: "auth.syncFollows",
    description: "auth.featureDescriptions.followSync",
  },
  "follow:platform": {
    title: "auth.followOnPlatform",
    description: "auth.featureDescriptions.followPlatform",
  },
  "channel-points": {
    title: "auth.channelPoints",
    description: "auth.featureDescriptions.channelPoints",
  },
  subscriptions: {
    title: "auth.subscriptions",
    description: "auth.featureDescriptions.subscriptions",
  },
  predictions: {
    title: "auth.predictions",
    description: "auth.featureDescriptions.predictions",
  },
  polls: {
    title: "auth.polls",
    description: "auth.featureDescriptions.polls",
  },
  "clips:create": {
    title: "auth.createClips",
    description: "auth.featureDescriptions.clipsCreate",
  },
  "notifications:live": {
    title: "auth.liveNotifications",
    description: "auth.featureDescriptions.notificationsLive",
  },
};

/**
 * Check if a feature requires authentication
 */
function requiresAuth(_feature: GatedFeature): boolean {
  // All gated features require auth
  return true;
}

/**
 * Get the description for a gated feature
 */
function getFeatureDescription(feature: GatedFeature, t: TFunction) {
  const description = featureDescriptions[feature];
  return { title: t(description.title), description: t(description.description) };
}

// ========== Login Prompt ==========

interface LoginPromptProps {
  feature?: GatedFeature;
  title?: string;
  description?: string;
  variant?: "inline" | "card" | "modal";
  onLoginClick?: () => void;
  className?: string;
}

/**
 * Prompt to encourage guests to log in
 */
function LoginPrompt({
  feature,
  title,
  description,
  variant = "card",
  onLoginClick,
  className = "",
}: LoginPromptProps) {
  const { t } = useTranslation();
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loginKick = useAuthStore((state) => state.loginKick);

  const featureInfo = feature ? getFeatureDescription(feature, t) : null;
  const displayTitle = title || featureInfo?.title || t("auth.loginRequired");
  const displayDescription = description || featureInfo?.description || t("auth.connectForFeature");

  const handleLoginClick = () => {
    if (onLoginClick) {
      onLoginClick();
    }
  };

  if (variant === "inline") {
    return (
      <button
        onClick={handleLoginClick}
        className={`inline-flex items-center gap-1.5 text-sm text-[var(--color-storm-primary)] hover:text-[var(--color-storm-primary-hover)] transition-colors ${className}`}
      >
        <LuLogIn size={14} />
        <span>{t("auth.loginTo", { title: displayTitle.toLowerCase() })}</span>
      </button>
    );
  }

  return (
    <div
      className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-storm-primary)]/10 flex items-center justify-center">
          <LuLock size={20} className="text-[var(--color-storm-primary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white mb-1">{displayTitle}</h3>
          <p className="text-sm text-[var(--color-foreground-muted)] mb-3">{displayDescription}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                handleLoginClick();
                loginTwitch();
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-[#9146FF] hover:bg-[#772CE8] text-white transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
              </svg>
              {t("auth.connectTwitch")}
            </button>
            <button
              onClick={() => {
                handleLoginClick();
                loginKick();
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-[#53FC18] hover:bg-[#45d414] text-black transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                <path d="M9 3a1 1 0 0 1 1 1v3h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h6a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-1v1a1 1 0 0 1 -.883 .993l-.117 .007h-1v2h1a1 1 0 0 1 .993 .883l.007 .117v1h1a1 1 0 0 1 .993 .883l.007 .117v4a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-1h-1a1 1 0 0 1 -.993 -.883l-.007 -.117v-1h-1v3a1 1 0 0 1 -.883 .993l-.117 .007h-5a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z" />
              </svg>
              {t("auth.connectKick")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== Feature Gate Wrapper ==========

interface FeatureGateProps {
  feature: GatedFeature;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showPrompt?: boolean;
}

/**
 * Wrapper component that gates content behind authentication
 */
function FeatureGate({ feature, children, fallback, showPrompt = true }: FeatureGateProps) {
  const isGuest = useAuthStore((state) => state.isGuest);

  if (!isGuest) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (showPrompt) {
    return <LoginPrompt feature={feature} />;
  }

  return null;
}

// ========== Guest Welcome Banner ==========

interface GuestWelcomeBannerProps {
  onDismiss?: () => void;
  className?: string;
}

/**
 * Welcome banner for guests with login CTA
 */
function GuestWelcomeBanner({ onDismiss, className = "" }: GuestWelcomeBannerProps) {
  const { t } = useTranslation();
  const isGuest = useAuthStore((state) => state.isGuest);
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loginKick = useAuthStore((state) => state.loginKick);

  if (!isGuest) return null;

  return (
    <div
      className={`relative rounded-lg bg-gradient-to-r from-[var(--color-storm-primary)]/20 via-[#9146FF]/10 to-[#53FC18]/10 border border-[var(--color-border)] p-4 ${className}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white mb-1">{t("auth.welcome")}</h3>
          <p className="text-sm text-[var(--color-foreground-muted)]">
            {t("auth.welcomeDescription")}
          </p>
        </div>
        <div className="flex-shrink-0 flex gap-2">
          <button
            onClick={loginTwitch}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-[#9146FF] hover:bg-[#772CE8] text-white transition-colors"
          >
            {t("auth.connectTwitch")}
          </button>
          <button
            onClick={loginKick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-[#53FC18] hover:bg-[#45d414] text-black transition-colors"
          >
            {t("auth.connectKick")}
          </button>
        </div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 rounded-full text-[var(--color-foreground-muted)] hover:text-white hover:bg-white/10 transition-colors"
          aria-label={t("auth.dismiss")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
