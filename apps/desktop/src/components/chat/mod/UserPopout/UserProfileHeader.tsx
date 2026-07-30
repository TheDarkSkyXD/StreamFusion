import { CalendarDays, Radio, UserRound } from "lucide-react";

import { ProxiedImage } from "@/components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TwitchPublicIdentity } from "@/shared/user-profile-types";

import type { RenderFieldState } from "./useUserProfile";

interface UserProfileHeaderProps {
  fallbackUsername: string;
  identity: RenderFieldState<TwitchPublicIdentity>;
  accountCreated: RenderFieldState<string>;
  follow: RenderFieldState<string>;
  retryIdentity: () => void;
  retryAccountCreated: () => void;
  retryFollow: () => void;
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

function RetryValue({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <button
      type="button"
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

function DateValue({
  field,
  kind,
  onRetry,
}: {
  field: RenderFieldState<string>;
  kind: "account" | "follow";
  onRetry: () => void;
}) {
  if (field.state === "loading") return <span aria-label="Loading">Loading…</span>;
  if (field.state === "known") {
    const absolute = formatAbsoluteDate(field.value);
    if (!absolute) {
      return (
        <RetryValue
          label={kind === "account" ? "Couldn’t verify" : "Unavailable"}
          onRetry={onRetry}
        />
      );
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={field.value} tabIndex={0}>
            {absolute}
          </time>
        </TooltipTrigger>
        <TooltipContent>{formatRelativeDate(field.value)}</TooltipContent>
      </Tooltip>
    );
  }
  if (field.state === "negative") return <span>Not following</span>;
  return (
    <RetryValue label={kind === "account" ? "Couldn’t verify" : "Unavailable"} onRetry={onRetry} />
  );
}

export function UserProfileHeader({
  fallbackUsername,
  identity,
  accountCreated,
  follow,
  retryIdentity,
  retryAccountCreated,
  retryFollow,
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
            <DateValue field={accountCreated} kind="account" onRetry={retryAccountCreated} />
          </dd>
          <dt className="flex items-center gap-1.5 text-[var(--color-foreground-muted)]">
            <Radio className="h-3.5 w-3.5" aria-hidden />
            Following since
          </dt>
          <dd className="text-white">
            <DateValue field={follow} kind="follow" onRetry={retryFollow} />
          </dd>
        </dl>
      </div>
    </div>
  );
}
