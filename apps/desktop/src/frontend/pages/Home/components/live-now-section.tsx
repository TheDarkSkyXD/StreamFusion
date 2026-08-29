import type { UnifiedStream } from "@shared/platform-types";
import { StreamGrid } from "@/features/discovery/components/stream/stream-grid";

interface LiveNowSectionProps {
  streams?: UnifiedStream[];
  isLoading: boolean;
}

export function LiveNowSection({ streams, isLoading }: LiveNowSectionProps) {
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
          <span className="w-1.5 h-6 bg-[var(--color-primary)] rounded-full inline-block" />
          Live Channels
        </h2>
      </div>

      <StreamGrid streams={streams} isLoading={isLoading} skeletons={8} />
    </section>
  );
}
