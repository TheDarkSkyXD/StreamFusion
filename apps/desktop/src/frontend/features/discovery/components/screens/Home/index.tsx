import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useInfiniteTopStreams } from "@/features/discovery/components/hooks/queries/useInfiniteStreams";

import { LiveNowSection } from "./components/live-now-section";
import { FeaturedStage } from "./components/featured-stage";

export function HomePage() {
  const { t } = useTranslation();
  const {
    data: streams,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    loadMoreError,
    unavailablePlatforms,
    fetchNextPage,
    refetch,
  } = useInfiniteTopStreams();

  if (error) {
    return (
      <div className="p-12 flex flex-col items-center justify-center space-y-4 text-center">
        <div className="text-red-500 text-xl font-bold">{t("home.failed")}</div>
        <p className="text-[var(--color-foreground-secondary)]">{error.message}</p>
        <Button onClick={() => void refetch()} variant="outline">
          {t("home.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-8 p-3 sm:p-6">
      <section>
        <FeaturedStage
          stream={streams?.[0]}
          streams={streams?.slice(0, 10)}
          isLoading={isLoading}
        />
      </section>

      <LiveNowSection
        streams={streams?.slice(1) ?? []}
        isLoading={isLoading}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreError={loadMoreError}
        unavailablePlatforms={unavailablePlatforms}
        onLoadMore={fetchNextPage}
        onRetryUnavailable={() => void refetch()}
      />

      <div className="flex justify-center pt-8">
        <Link to="/categories">
          <Button variant="outline" size="lg" className="rounded-full px-8">
            {t("home.browseCategories")}
          </Button>
        </Link>
      </div>
    </div>
  );
}
