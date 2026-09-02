import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useInfiniteTopStreams } from "@/features/discovery/data/queries/useInfiniteStreams";

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

  const featuredStream = streams && streams.length > 0 ? streams[0] : undefined;
  const featuredStreams = streams?.slice(0, 10);
  const otherStreams = streams && streams.length > 1 ? streams.slice(1) : [];

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
    <div className="p-6 space-y-8 max-w-[1800px] mx-auto">
      <section>
        <FeaturedStage stream={featuredStream} streams={featuredStreams} isLoading={isLoading} />
      </section>

      {/* Live Channels Section */}
      <LiveNowSection
        streams={otherStreams}
        isLoading={isLoading}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreError={loadMoreError}
        unavailablePlatforms={unavailablePlatforms}
        onLoadMore={() => void fetchNextPage()}
        onRetryUnavailable={() => void refetch()}
      />

      {/* Browse Categories Link */}
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
