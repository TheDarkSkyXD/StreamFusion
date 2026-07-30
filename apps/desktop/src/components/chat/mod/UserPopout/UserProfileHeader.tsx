import { BadgeCheck, CalendarDays, Radio, UserRound } from "lucide-react";

import { ProxiedImage } from "@/components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatBadge } from "@/shared/chat-types";
import type { PublicUserIdentity } from "@/shared/user-profile-types";

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

const ABSOLUTE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatAbsoluteDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? ABSOLUTE_DATE_FORMATTER.format(date) : null;
}

function formatRelativeDate(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days < 1) return "Today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  if (years >= 1) return `${years} year${years === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
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
  return (
    <button
      type="button"
      data-profile-state={state}
      className="rounded text-left text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      onClick={onRetry}
    >
      {label} · Retry
    </button>
  );
}

function AvatarFallback({ displayName }: { displayName: string }) {
  return (
    <span
      role="img"
      aria-label={`${displayName} avatar unavailable`}
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
  const platformLabel = platform === "kick" ? "Kick" : "Twitch";
  const sourceLabel =
    badges.state === "loading"
      ? `${platformLabel} · Live chat`
      : (badges.sourceLabel ?? `${platformLabel} · Live chat`);
  return (
    <section className="mt-4 min-w-0" aria-labelledby="user-profile-badges-heading">
      <h3
        id="user-profile-badges-heading"
        className="flex items-center gap-1.5 text-xs text-[var(--color-foreground-muted)]"
      >
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
        Badges
      </h3>
      {badges.state === "loading" ? (
        <p className="mt-2 text-xs text-[var(--color-foreground-muted)]">Badges loading…</p>
      ) : badges.state === "failed" ? (
        <button
          type="button"
          className="mt-2 rounded text-xs text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={badges.retry}
        >
          Couldn’t load badges · Retry
        </button>
      ) : badges.badges.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-foreground-muted)]">
          No badges on the latest message
        </p>
      ) : (
        <div
          className="mt-2 flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1"
          data-testid="user-profile-badges"
        >
          {badges.badges.map((badge, index) => {
            const badgeName = badge.title || badge.setId || "Badge";
            return (
              <Tooltip key={`${badge.setId}-${badge.version}-${index}`}>
                <TooltipTrigger asChild>
                  <span
                    role="img"
                    tabIndex={0}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label={badgeName}
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
                  <span aria-hidden>{badgeName} · </span>
                  <span>{sourceLabel}</span>
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
  if (field.state === "loading")
    return (
      <span aria-label="Loading" data-profile-state="loading">
        Loading…
      </span>
    );
  if (field.state === "known") {
    const absolute = formatAbsoluteDate(field.value);
    if (!absolute) {
      return (
        <RetryValue
          label={kind === "account" ? "Couldn’t verify" : "Unavailable"}
          state="failed"
          onRetry={onRetry}
        />
      );
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={field.value} tabIndex={0} data-profile-state="known">
            {absolute}
          </time>
        </TooltipTrigger>
        <TooltipContent>{formatRelativeDate(field.value)}</TooltipContent>
      </Tooltip>
    );
  }
  if (field.state === "negative")
    return kind === "follow" ? (
      <span data-profile-state="negative">Not following</span>
    ) : (
      <RetryValue label="Couldn’t verify" state="failed" onRetry={onRetry} />
    );
  if (field.state === "reconnect-required")
    return (
      <RetryValue
        label={`Reconnect ${platform === "kick" ? "Kick" : "Twitch"}`}
        state={field.state}
        onRetry={onReconnect}
      />
    );
  if (field.state === "unavailable")
    return <RetryValue label="Unavailable" state={field.state} onRetry={onRetry} />;
  return <RetryValue label="Couldn’t verify" state="failed" onRetry={onRetry} />;
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
  const knownIdentity = identity.state === "known" ? identity.value : null;
  const username = knownIdentity?.username ?? fallbackUsername;
  const displayName = knownIdentity?.displayName ?? fallbackUsername;
  return (
    <div className="flex gap-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/10">
        {knownIdentity?.avatarUrl ? (
          <ProxiedImage
            src={knownIdentity.avatarUrl}
            alt={`${displayName} avatar`}
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
          <p className="mt-1 text-xs text-[var(--color-foreground-muted)]">Profile loading…</p>
        ) : identity.state !== "known" ? (
          <div className="mt-1 text-xs">
            <RetryValue label="Profile unavailable" onRetry={retryIdentity} />
          </div>
        ) : null}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="flex items-center gap-1.5 text-[var(--color-foreground-muted)]">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            Account created
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
            Following since
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
