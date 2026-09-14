import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { UnifiedStream } from "@shared/platform-types";
import { Platform } from "@streamfusion/core/platform";
import { Button } from "@/components/ui/button";
import { StreamGrid } from "@/features/discovery/components/stream/stream-grid";

const MAIN_CONTENT_SCROLL_AREA_ID = "main-content-scroll-area";
const LOAD_MORE_ROOT_MARGIN = "1500px 0px";

interface LiveNowSectionProps {
  streams?: UnifiedStream[];
  isLoading: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  loadMoreError?: boolean;
  unavailablePlatforms?: Platform[];
  onLoadMore?: () => void;
  onRetryUnavailable?: () => void;
}

export function LiveNowSection({
  streams,
  isLoading,
  hasNextPage = false,
  isFetchingNextPage = false,
  loadMoreError = false,
  unavailablePlatforms = [],
  onLoadMore,
  onRetryUnavailable,
}: LiveNowSectionProps) {
  const { i18n, t } = useTranslation();
  const unavailableProviders = formatUnavailableProviders(
    unavailablePlatforms,
    i18n.resolvedLanguage ?? "en"
  );

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
          <span className="w-1.5 h-6 bg-[var(--color-primary)] rounded-full inline-block" />
          {t("home.liveChannels")}
        </h2>
      </div>

      <StreamGrid streams={streams} isLoading={isLoading} skeletons={8} />

      {unavailableProviders ? (
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-[var(--color-foreground-secondary)]">
          <span>{t("home.providersUnavailable", { providers: unavailableProviders })}</span>
          {onRetryUnavailable ? (
            <Button variant="ghost" size="sm" onClick={onRetryUnavailable}>
              {t("home.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {hasNextPage && onLoadMore ? (
        <LiveChannelsLoadMore
          isFetchingNextPage={isFetchingNextPage}
          loadMoreError={loadMoreError}
          onLoadMore={onLoadMore}
        />
      ) : null}
    </section>
  );
}

function LiveChannelsLoadMore({
  isFetchingNextPage,
  loadMoreError,
  onLoadMore,
}: {
  isFetchingNextPage: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const sentinelRef = useLiveChannelsSentinel(!loadMoreError && !isFetchingNextPage, onLoadMore);
  const loadingLabel = t("home.loading");

  return (
    <div className="relative flex h-14 items-center justify-center">
      {loadMoreError ? null : (
        <div
          ref={sentinelRef}
          data-testid="live-channels-infinite-sentinel"
          className="absolute inset-0"
          aria-hidden="true"
        />
      )}
      {isFetchingNextPage ? (
        <div role="status" aria-label={loadingLabel}>
          <div
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-b-2 border-white motion-reduce:animate-none"
          />
          <span className="sr-only">{loadingLabel}</span>
        </div>
      ) : null}
      {loadMoreError ? (
        <Button variant="outline" onClick={onLoadMore}>
          {t("home.retryLoading")}
        </Button>
      ) : null}
    </div>
  );
}

function useLiveChannelsSentinel(enabled: boolean, onLoadMore: () => void): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestMore = useEffectEvent(() => {
    onLoadMore();
  });

  useEffect(() => {
    const target = sentinelRef.current;
    if (!enabled || !target || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) requestMore();
      },
      {
        root: document.getElementById(MAIN_CONTENT_SCROLL_AREA_ID),
        rootMargin: LOAD_MORE_ROOT_MARGIN,
        threshold: 0,
      }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled]);

  return sentinelRef;
}

function formatUnavailableProviders(platforms: Platform[], locale: string): string {
  if (platforms.length === 0) return "";

  const names = platforms.map((platform) => (platform === "twitch" ? "Twitch" : "Kick"));
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
}
