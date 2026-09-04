import { BadgeCheck, CalendarDays, Radio, UserRound } from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ProxiedImage } from "@/components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatBadge } from "@streamfusion/core/chat";
import type { PublicUserIdentity } from "@shared/user-profile-types";

import type { RenderAccountCreatedState, RenderFieldState } from "./useUserProfile";

interface UserProfileHeaderProps {
  platform?: "twitch" | "kick";
  fallbackUsername: string;
  identity: RenderFieldState<PublicUserIdentity>;
  accountCreated: RenderAccountCreatedState;
  follow: RenderFieldState<string>;
  retryIdentity: () => void;
  retryAccountCreated: () => void;
  retryFollow: () => void;
  reconnect?: () => void;
  badges?:
    | { state: "loading" }
    | { state: "known"; badges: ChatBadge[]; sourceLabel?: string }
    | { state: "failed"; retry: () => void; sourceLabel?: string };
}

const absoluteDateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatAbsoluteDate(iso: string, locale: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  let formatter = absoluteDateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    absoluteDateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}

function formatRelativeDate(iso: string, t: TFunction): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days < 1) return t("chatModeration.today");
  if (days < 30) return t("chatModeration.daysAgo", { count: days });
  const years = Math.floor(days / 365);
  if (years >= 1) return t("chatModeration.yearsAgo", { count: years });
  const months = Math.floor(days / 30);
  return t("chatModeration.monthsAgo", { count: months });
}

function RetryValue({
  label,
  state,
  onRetry,
}: {
  label: string;
  state?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-profile-state={state}
      className="rounded text-left text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      onClick={onRetry}
    >
      {t("chatModeration.retryWithLabel", { label })}
    </button>
  );
}

function AvatarFallback({ displayName }: { displayName: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t("chatModeration.avatarUnavailable", { displayName })}
      className="flex h-full w-full items-center justify-center"
    >
      <UserRound className="h-8 w-8 text-white/60" aria-hidden />
    </span>
  );
}

function BadgeSection({
  badges,
  platform,
}: {
  badges: NonNullable<UserProfileHeaderProps["badges"]>;
  platform: "twitch" | "kick";
}) {
  const { t } = useTranslation();
  const [hoveredBadge, setHoveredBadge] = useState<string | null>(null);
  const platformLabel = platform === "kick" ? "Kick" : "Twitch";
  const sourceLabel =
    badges.state === "loading"
      ? t("chatModeration.sourceLabel", { platform: platformLabel })
      : (badges.sourceLabel ?? t("chatModeration.sourceLabel", { platform: platformLabel }));
  return (
    <section className="mt-4 min-w-0" aria-labelledby="user-profile-badges-heading">
      <h3
        id="user-profile-badges-heading"
        className="flex items-center gap-1.5 text-xs text-[var(--color-foreground-muted)]"
      >
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
        {t("chatModeration.badges")}
      </h3>
      {badges.state === "loading" ? (
        <p className="mt-2 text-xs text-[var(--color-foreground-muted)]">
          {t("chatModeration.badgesLoading")}
        </p>
      ) : badges.state === "failed" ? (
        <button
          type="button"
          className="mt-2 rounded text-xs text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={badges.retry}
        >
          {t("chatModeration.couldntLoadBadgesRetry")}
        </button>
      ) : badges.badges.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-foreground-muted)]">
          {t("chatModeration.noBadgesLatestMessage")}
        </p>
      ) : (
        <div
          className="mt-2 flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1"
          data-testid="user-profile-badges"
        >
          {badges.badges.map((badge, index) => {
            const badgeName = badge.title || badge.setId || t("chat.badge");
            const badgeKey = `${badge.setId}-${badge.version}-${index}`;
            return (
              <Tooltip key={badgeKey} open={hoveredBadge === badgeKey}>
                <TooltipTrigger asChild>
                  <span
                    role="img"
                    tabIndex={0}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label={t("chatModeration.badgeSource", {
                      name: badgeName,
                      source: sourceLabel,
                    })}
                    onPointerEnter={() => setHoveredBadge(badgeKey)}
                    onPointerLeave={() => setHoveredBadge(null)}
                    onPointerCancel={() => setHoveredBadge(null)}
                  >
                    <img
                      src={badge.imageUrl}
                      alt=""
                      className="h-5 w-5 object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <span>
                    {t("chatModeration.badgeTooltip", {
                      name: badgeName,
                      source: sourceLabel,
                      defaultValue: "{{name}} · {{source}}",
                    })}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DateValue({
  field,
  kind,
  platform,
  onRetry,
  onReconnect,
}: {
  field: RenderFieldState<string>;
  kind: "account" | "follow";
  platform: "twitch" | "kick";
  onRetry: () => void;
  onReconnect: () => void;
}) {
  const { i18n, t } = useTranslation();
  const [showRelativeTooltip, setShowRelativeTooltip] = useState(false);

  if (field.state === "loading")
    return (
      <span aria-label={t("chatModeration.loading")} data-profile-state="loading">
        {t("chatModeration.loading")}
      </span>
    );
  if (field.state === "known") {
    const absolute = formatAbsoluteDate(field.value, i18n.resolvedLanguage ?? i18n.language);
    if (!absolute) {
      return (
        <RetryValue
          label={
            kind === "account" ? t("chatModeration.couldntVerify") : t("chatModeration.unavailable")
          }
          state="failed"
          onRetry={onRetry}
        />
      );
    }
    const relative = formatRelativeDate(field.value, t);
    return (
      <Tooltip open={showRelativeTooltip}>
        <TooltipTrigger asChild>
          <time
            dateTime={field.value}
            data-profile-state="known"
            aria-label={t("chatModeration.relativeDateLabel", { absolute, relative })}
            tabIndex={0}
            onPointerEnter={() => setShowRelativeTooltip(true)}
            onPointerLeave={() => setShowRelativeTooltip(false)}
            onPointerCancel={() => setShowRelativeTooltip(false)}
          >
            {absolute}
          </time>
        </TooltipTrigger>
        <TooltipContent>{relative}</TooltipContent>
      </Tooltip>
    );
  }
  if (field.state === "negative")
    return kind === "follow" ? (
      <span data-profile-state="negative">{t("chatModeration.notFollowing")}</span>
    ) : (
      <RetryValue label={t("chatModeration.couldntVerify")} state="failed" onRetry={onRetry} />
    );
  if (field.state === "reconnect-required")
    return (
      <RetryValue
        label={t("chatModeration.reconnectPlatform", {
          platform: platform === "kick" ? "Kick" : "Twitch",
        })}
        state={field.state}
        onRetry={onReconnect}
      />
    );
  if (field.state === "unavailable")
    return (
      <RetryValue label={t("chatModeration.unavailable")} state={field.state} onRetry={onRetry} />
    );
  return <RetryValue label={t("chatModeration.couldntVerify")} state="failed" onRetry={onRetry} />;
}

export function UserProfileHeader({
  platform = "twitch",
  fallbackUsername,
  identity,
  accountCreated,
  follow,
  retryIdentity,
  retryAccountCreated,
  retryFollow,
  reconnect = retryFollow,
  badges,
}: UserProfileHeaderProps) {
  const { t } = useTranslation();
  const knownIdentity = identity.state === "known" ? identity.value : null;
  const username = knownIdentity?.username ?? fallbackUsername;
  const displayName = knownIdentity?.displayName ?? fallbackUsername;
  return (
    <div className="flex gap-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/10">
        {knownIdentity?.avatarUrl ? (
          <ProxiedImage
            src={knownIdentity.avatarUrl}
            alt={t("chatModeration.avatarAlt", { displayName })}
            className="h-full w-full object-cover"
            fallback={<AvatarFallback displayName={displayName} />}
          />
        ) : (
          <AvatarFallback displayName={displayName} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold text-white">{displayName}</h2>
        <p className="mt-0.5 truncate text-xs text-[var(--color-foreground-muted)]">@{username}</p>
        {identity.state === "loading" ? (
          <p className="mt-1 text-xs text-[var(--color-foreground-muted)]">
            {t("chatModeration.profileLoading")}
          </p>
        ) : identity.state !== "known" ? (
          <div className="mt-1 text-xs">
            <RetryValue label={t("chatModeration.profileUnavailable")} onRetry={retryIdentity} />
          </div>
        ) : null}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="flex items-center gap-1.5 text-[var(--color-foreground-muted)]">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {t("chatModeration.accountCreated")}
          </dt>
          <dd className="text-white">
            <DateValue
              field={accountCreated}
              kind="account"
              platform={platform}
              onRetry={retryAccountCreated}
              onReconnect={reconnect}
            />
          </dd>
          <dt className="flex items-center gap-1.5 text-[var(--color-foreground-muted)]">
            <Radio className="h-3.5 w-3.5" aria-hidden />
            {t("chatModeration.followingSince")}
          </dt>
          <dd className="text-white">
            <DateValue
              field={follow}
              kind="follow"
              platform={platform}
              onRetry={retryFollow}
              onReconnect={reconnect}
            />
          </dd>
        </dl>
        {badges ? <BadgeSection badges={badges} platform={platform} /> : null}
      </div>
    </div>
  );
}
