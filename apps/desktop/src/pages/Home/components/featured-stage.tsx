import { useMemo, useState } from "react";

import type { UnifiedChannel, UnifiedStream } from "@/backend/api/unified/platform-types";
import { ChatPanel, type ChatPanelProps } from "@/components/chat";
import { FeaturedStream } from "@/components/stream/featured-stream";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useChannelByUsername } from "@/hooks/queries/useChannels";
import { useInterval } from "@/hooks/useInterval";
import { useAppStore } from "@/store/app-store";

const FEATURED_CHAT_QUERY = "(min-width: 1280px)";

type FeaturedStreamIdentity = `${UnifiedStream["platform"]}:${string}`;

type FeaturedChatTarget =
  | { kind: "absent" }
  | { kind: "loading" }
  | { kind: "failed"; retry: () => void }
  | { kind: "ready"; chatPanelProps: ChatPanelProps };

interface FeaturedStageProps {
  stream?: UnifiedStream;
  streams?: UnifiedStream[];
  isLoading: boolean;
  canRenderContent: boolean;
}

export function FeaturedStage({
  stream,
  streams,
  isLoading,
  canRenderContent,
}: FeaturedStageProps) {
  const carouselStreams = useMemo(() => {
    const candidates = streams && streams.length > 0 ? streams : stream ? [stream] : [];
    return candidates.slice(0, 10);
  }, [stream, streams]);
  const [activeStreamIdentity, setActiveStreamIdentity] = useState<FeaturedStreamIdentity>();
  const [isPointerInsideChat, setIsPointerInsideChat] = useState(false);
  const [isFocusInsideChat, setIsFocusInsideChat] = useState(false);
  const isWide = useMediaQuery(FEATURED_CHAT_QUERY);
  const homeCarouselIntervalMs = useAppStore((state) => state.homeCarouselIntervalMs);
  const activeIndex = getActiveStreamIndex(carouselStreams, activeStreamIdentity);
  const activeStream = carouselStreams[activeIndex];
  const resolvedActiveStreamIdentity = activeStream
    ? getFeaturedStreamIdentity(activeStream)
    : undefined;
  const isCarouselPaused = isPointerInsideChat || isFocusInsideChat;

  useInterval(
    () => {
      selectActiveIndex(activeIndex >= carouselStreams.length - 1 ? 0 : activeIndex + 1);
    },
    canRenderContent &&
      !isLoading &&
      !isWide &&
      carouselStreams.length > 1 &&
      !isCarouselPaused
      ? homeCarouselIntervalMs
      : null
  );

  if (!canRenderContent || isLoading) {
    return <FeaturedStageSkeleton showChat={isWide} />;
  }

  if (!activeStream) return null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_clamp(320px,24vw,385px)]">
      <FeaturedStream
        stream={activeStream}
        streams={carouselStreams}
        activeIndex={activeIndex}
        onActiveIndexChange={selectActiveIndex}
        isAutoRotationEnabled={false}
      />
      {isWide && resolvedActiveStreamIdentity && (
        <FeaturedChatRail
          key={resolvedActiveStreamIdentity}
          activeStream={activeStream}
          identity={resolvedActiveStreamIdentity}
          onFocusInsideChange={setIsFocusInsideChat}
          onPointerInsideChange={setIsPointerInsideChat}
        />
      )}
    </div>
  );

  function selectActiveIndex(index: number) {
    const selectedStream = carouselStreams[index];
    if (selectedStream) setActiveStreamIdentity(getFeaturedStreamIdentity(selectedStream));
  }
}

function FeaturedChatRail({
  activeStream,
  identity,
  onFocusInsideChange,
  onPointerInsideChange,
}: {
  activeStream: UnifiedStream;
  identity: FeaturedStreamIdentity;
  onFocusInsideChange: (isInside: boolean) => void;
  onPointerInsideChange: (isInside: boolean) => void;
}) {
  const channelQuery = useChannelByUsername(activeStream.channelName, activeStream.platform);
  const target = getFeaturedChatTarget({
    activeStream,
    channel: channelQuery.data,
    isLoading: channelQuery.isLoading,
    isError: channelQuery.isError,
    retry: () => void channelQuery.refetch(),
  });

  return (
    <aside
      data-testid="featured-chat-rail"
      className="h-[560px] min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)]"
      onPointerEnter={() => onPointerInsideChange(true)}
      onPointerLeave={() => onPointerInsideChange(false)}
      onFocusCapture={() => onFocusInsideChange(true)}
      onBlurCapture={(event) => {
        if (!containsEventTarget(event.currentTarget, event.relatedTarget)) {
          onFocusInsideChange(false);
        }
      }}
    >
      {renderFeaturedChatTarget(target, identity)}
    </aside>
  );
}

function getFeaturedChatTarget({
  activeStream,
  channel,
  isLoading,
  isError,
  retry,
}: {
  activeStream?: UnifiedStream;
  channel?: UnifiedChannel;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}): FeaturedChatTarget {
  if (!activeStream) return { kind: "absent" };
  if (isLoading) return { kind: "loading" };
  if (isError) return { kind: "failed", retry };
  if (!channel || !isMatchingChannel(activeStream, channel)) return { kind: "failed", retry };

  if (activeStream.platform === "kick") {
    if (!channel.id || !channel.kickChannelId || !channel.chatroomId) {
      return { kind: "failed", retry };
    }

    return {
      kind: "ready",
      chatPanelProps: {
        initialPlatform: "kick",
        initialChannel: activeStream.channelName,
        channelId: channel.id,
        kickChannelId: channel.kickChannelId,
        chatroomId: channel.chatroomId,
        kickUserId: channel.kickUserId,
        subscriberBadges: channel.subscriberBadges,
        badgeCatalogState: "ready",
        retryBadgeCatalog: retry,
      },
    };
  }

  if (!channel.id) return { kind: "failed", retry };

  return {
    kind: "ready",
    chatPanelProps: {
      initialPlatform: "twitch",
      initialChannel: activeStream.channelName,
      channelId: channel.id,
    },
  };
}

function renderFeaturedChatTarget(target: FeaturedChatTarget, identity: FeaturedStreamIdentity) {
  switch (target.kind) {
    case "absent":
      return null;
    case "loading":
      return <FeaturedChatSkeleton />;
    case "failed":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-semibold text-[var(--color-foreground)]">
            Chat is unavailable
          </p>
          <Button variant="outline" size="sm" onClick={target.retry}>
            Retry
          </Button>
        </div>
      );
    case "ready":
      return <ChatPanel key={identity} {...target.chatPanelProps} />;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function FeaturedStageSkeleton({ showChat }: { showChat: boolean }) {
  return (
    <div
      data-testid="featured-stage-skeleton"
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_clamp(320px,24vw,385px)]"
    >
      <div className="relative h-[560px] overflow-hidden rounded-lg bg-[var(--color-background-secondary)]">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-x-4 bottom-4 rounded-lg border border-white/10 bg-black/65 p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-3/5" />
            </div>
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
          <Skeleton className="mt-6 h-2 w-12 rounded-full" />
        </div>
      </div>
      {showChat && <FeaturedChatSkeleton />}
    </div>
  );
}

function FeaturedChatSkeleton() {
  return (
    <div
      data-testid="featured-chat-skeleton"
      className="h-[560px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4"
    >
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 14 }, (_, index) => (
          <div key={index} className="flex gap-2">
            <Skeleton className="h-5 w-12 shrink-0 rounded" />
            <Skeleton className={index % 3 === 0 ? "h-5 w-4/5 rounded" : "h-5 w-3/5 rounded"} />
          </div>
        ))}
      </div>
    </div>
  );
}

function getFeaturedStreamIdentity(stream: UnifiedStream): FeaturedStreamIdentity {
  return `${stream.platform}:${stream.id}`;
}

function getActiveStreamIndex(
  streams: UnifiedStream[],
  activeStreamIdentity: FeaturedStreamIdentity | undefined
): number {
  if (!activeStreamIdentity) return 0;
  const index = streams.findIndex(
    (candidate) => getFeaturedStreamIdentity(candidate) === activeStreamIdentity
  );
  return index >= 0 ? index : 0;
}

function isMatchingChannel(stream: UnifiedStream, channel: UnifiedChannel): boolean {
  return (
    stream.platform === channel.platform &&
    stream.channelName.trim().toLowerCase() === channel.username.trim().toLowerCase()
  );
}

function containsEventTarget(element: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && element.contains(target);
}
