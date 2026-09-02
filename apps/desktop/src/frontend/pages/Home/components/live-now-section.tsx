import type { UnifiedStream } from "@shared/platform-types";
import type { Platform } from "@shared/auth-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StreamGrid } from "@/features/discovery/components/stream/stream-grid";

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
  const unavailableNames = unavailablePlatforms.map((platform) =>
    platform === "twitch" ? "Twitch" : "Kick"
  );
  const unavailableProviders = new Intl.ListFormat(i18n.resolvedLanguage ?? "en", {
    style: "long",
    type: "conjunction",
  }).format(unavailableNames);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
          <span className="w-1.5 h-6 bg-[var(--color-primary)] rounded-full inline-block" />
          {t("home.liveChannels")}
        </h2>
      </div>

      <StreamGrid streams={streams} isLoading={isLoading} skeletons={8} />

      {unavailableNames.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-[var(--color-foreground-secondary)]">
          <span>{t("home.providersUnavailable", { providers: unavailableProviders })}</span>
          {onRetryUnavailable && (
            <Button variant="ghost" size="sm" onClick={onRetryUnavailable}>
              {t("home.retry")}
            </Button>
          )}
        </div>
      )}

      {hasNextPage && onLoadMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onLoadMore} disabled={isFetchingNextPage}>
            {isFetchingNextPage
              ? t("home.loading")
              : loadMoreError
                ? t("home.retryLoading")
                : t("home.loadMore")}
          </Button>
        </div>
      )}
    </section>
  );
}
