import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useTopStreams } from "@/hooks/queries/useStreams";
import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint";

import { LiveNowSection } from "./components/live-now-section";
import { FeaturedStage } from "./components/featured-stage";

export function HomePage() {
  const { data: streams, isLoading, error } = useTopStreams(undefined, 25);
  const canRenderContent = useAfterFirstPaint();

  const featuredStream = streams && streams.length > 0 ? streams[0] : undefined;
  const featuredStreams = streams?.slice(0, 10);
  const otherStreams = streams && streams.length > 1 ? streams.slice(1) : [];

  if (error) {
    return (
      <div className="p-12 flex flex-col items-center justify-center space-y-4 text-center">
        <div className="text-red-500 text-xl font-bold">Failed to load streams</div>
        <p className="text-[var(--color-foreground-secondary)]">{error.message}</p>
        <Button onClick={() => window.location.reload()} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-[1800px] mx-auto">
      <section>
        <FeaturedStage
          stream={featuredStream}
          streams={featuredStreams}
          isLoading={isLoading}
          canRenderContent={canRenderContent}
        />
      </section>

      {/* Live Channels Section */}
      {canRenderContent ? (
        <LiveNowSection streams={otherStreams} isLoading={isLoading} />
      ) : (
        <div className="space-y-4">
          <div className="h-7 w-36 rounded bg-[var(--color-background-secondary)] animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="aspect-video rounded-xl bg-[var(--color-background-secondary)] animate-pulse"
              />
            ))}
          </div>
        </div>
      )}

      {/* Browse Categories Link */}
      <div className="flex justify-center pt-8">
        <Link to="/categories">
          <Button variant="outline" size="lg" className="rounded-full px-8">
            Browse All Categories
          </Button>
        </Link>
      </div>
    </div>
  );
}
