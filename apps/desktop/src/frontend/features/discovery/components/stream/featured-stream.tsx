import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight, LuVolume2, LuVolumeX } from "react-icons/lu";
import { useTranslation } from "react-i18next";

import type { UnifiedStream } from "@shared/platform-types";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { HlsPlayer } from "@/features/playback/components/player/hls-player";
import { TwitchHlsPlayer } from "@/features/playback/components/player/twitch/twitch-hls-player";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Skeleton } from "@/components/ui/skeleton";
import { useInterval } from "@/hooks/useInterval";
import { useStreamPlayback } from "@/features/playback/data/useStreamPlayback";
import { cn, formatLanguageLabel, formatViewerCount, uniqueTagLabels } from "@/lib/utils";
import { useAdBlockStore } from "@/store/adblock-store";
import { useAppStore } from "@/store/app-store";
import { usePipStore } from "@/store/pip-store";
import { useVolumeStore } from "@/store/volume-store";

interface FeaturedStreamProps {
  stream?: UnifiedStream;
  streams?: UnifiedStream[];
  isLoading?: boolean;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  isAutoRotationEnabled?: boolean;
}

export function FeaturedStream({
  stream,
  streams,
  isLoading,
  activeIndex: controlledActiveIndex,
  onActiveIndexChange,
  isAutoRotationEnabled = true,
}: FeaturedStreamProps) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const carouselStreams = useMemo(() => {
    const candidates = streams && streams.length > 0 ? streams : stream ? [stream] : [];
    return candidates.slice(0, 10);
  }, [stream, streams]);
  const [uncontrolledActiveIndex, setUncontrolledActiveIndex] = useState(0);
  const [isPreviewMuted, setIsPreviewMuted] = useState(true);
  const unavailablePreviewIdentitiesRef = useRef(new Set<string>());
  const carouselIdentity = useMemo(
    () => carouselStreams.map((item) => `${item.platform}:${item.channelName}`).join("|"),
    [carouselStreams]
  );
  const activeIndex = controlledActiveIndex ?? uncontrolledActiveIndex;
  const activeStream = carouselStreams[activeIndex] ?? carouselStreams[0];
  const hasMultipleSlides = carouselStreams.length > 1;
  const homeCarouselIntervalMs = useAppStore((state) => state.homeCarouselIntervalMs);
  const isPersistentPlayerActive = usePipStore((state) => state.isPipActive);
  const volume = useVolumeStore((state) => state.volume);
  const setVolume = useVolumeStore((state) => state.setVolume);
  const previewVolume = Math.max(0, Math.min(1, volume / 100));
  const previewMuted = isPreviewMuted || previewVolume <= 0;

  useEffect(() => {
    if (controlledActiveIndex !== undefined || uncontrolledActiveIndex < carouselStreams.length)
      return;
    setUncontrolledActiveIndex(0);
  }, [carouselStreams.length, controlledActiveIndex, uncontrolledActiveIndex]);

  useEffect(() => {
    unavailablePreviewIdentitiesRef.current.clear();
  }, [carouselIdentity]);

  useInterval(
    () => {
      changeActiveIndex(activeIndex >= carouselStreams.length - 1 ? 0 : activeIndex + 1);
    },
    hasMultipleSlides && isAutoRotationEnabled ? homeCarouselIntervalMs : null
  );

  if (isLoading) {
    return (
      <div className="relative h-[560px] w-full overflow-hidden rounded-lg bg-[var(--color-background-secondary)]">
        <Skeleton className="w-full h-full" />
        <div className="absolute inset-x-4 bottom-4 rounded-lg border border-white/10 bg-black/65 p-4 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-3/5" />
            </div>
            <Skeleton className="hidden h-9 w-24 rounded-md sm:block" />
          </div>
        </div>
      </div>
    );
  }

  if (!activeStream) return null;

  function changeActiveIndex(index: number) {
    if (onActiveIndexChange) {
      onActiveIndexChange(index);
      return;
    }
    setUncontrolledActiveIndex(index);
  }

  const PlatformIcon = activeStream.platform === "twitch" ? TwitchIcon : KickIcon;
  const platformColor = activeStream.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]";
  const platformLiveDotColor = activeStream.platform === "twitch" ? "bg-[#9146FF]" : "bg-[#53FC18]";
  const watchNowClassName =
    activeStream.platform === "twitch"
      ? "bg-[#9146FF] text-white hover:bg-[#772CE8]"
      : "bg-[#53FC18] text-black hover:bg-[#3DD912]";
  const tags = [
    activeStream.categoryName,
    formatLanguageLabel(activeStream.language, locale),
    ...activeStream.tags,
  ].filter((tag): tag is string => Boolean(tag));
  const showTags = uniqueTagLabels(tags).slice(0, 2);

  const goToPrevious = () => {
    changeActiveIndex(
      activeIndex === 0 ? Math.max(carouselStreams.length - 1, 0) : activeIndex - 1
    );
  };

  const goToNext = () => {
    changeActiveIndex(activeIndex >= carouselStreams.length - 1 ? 0 : activeIndex + 1);
  };

  const skipUnavailablePreview = () => {
    const unavailable = unavailablePreviewIdentitiesRef.current;
    const activeIdentity = `${activeStream.platform}:${activeStream.channelName}`;
    if (unavailable.has(activeIdentity)) return;
    unavailable.add(activeIdentity);

    for (let offset = 1; offset < carouselStreams.length; offset += 1) {
      const candidateIndex = (activeIndex + offset) % carouselStreams.length;
      const candidate = carouselStreams[candidateIndex];
      if (!candidate || unavailable.has(`${candidate.platform}:${candidate.channelName}`)) continue;
      changeActiveIndex(candidateIndex);
      return;
    }
  };

  const togglePreviewAudio = () => {
    if (isPreviewMuted && volume <= 0) setVolume(50);
    setIsPreviewMuted((current) => !current);
  };

  return (
    <div className="group relative h-[560px] w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-black">
      <Link
        to="/stream/$platform/$channel"
        params={{ platform: activeStream.platform, channel: activeStream.channelName }}
        search={{ tab: "home" }}
        className="absolute inset-0"
        aria-label={t("home.watch", { channel: activeStream.channelDisplayName })}
      >
        <ProxiedImage
          src={activeStream.thumbnailUrl.replace("{width}", "1920").replace("{height}", "1080")}
          alt={activeStream.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          loading="eager"
          width={1920}
          height={1080}
        />
        {!isPersistentPlayerActive && (
          <FeaturedStreamPreview
            stream={activeStream}
            muted={previewMuted}
            volume={previewVolume > 0 ? previewVolume : 0.5}
            onUnavailable={skipUnavailablePreview}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/15" />
      </Link>

      <div className="absolute left-4 top-4 flex h-8 items-center gap-1.5 rounded bg-black/70 px-2.5 text-base font-extrabold text-white backdrop-blur-md">
        <span className={cn("h-2.5 w-2.5 rounded-full", platformLiveDotColor)} />
        {formatViewerCount(activeStream.viewerCount)}
      </div>

      {!isPersistentPlayerActive && (
        <button
          type="button"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded bg-black/65 text-white transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={previewMuted ? t("home.unmutePreview") : t("home.mutePreview")}
          title={previewMuted ? t("home.unmutePreview") : t("home.mutePreview")}
          onClick={togglePreviewAudio}
        >
          {previewMuted ? <LuVolumeX className="h-5 w-5" /> : <LuVolume2 className="h-5 w-5" />}
        </button>
      )}

      <div className="absolute inset-x-4 bottom-4 rounded-lg border border-white/10 bg-black/65 p-4 text-white backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
            <ProxiedImage
              src={activeStream.channelAvatar}
              alt={activeStream.channelDisplayName}
              className="h-full w-full object-cover"
              loading="eager"
              width={56}
              height={56}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                to="/stream/$platform/$channel"
                params={{ platform: activeStream.platform, channel: activeStream.channelName }}
                search={{ tab: "home" }}
                className="truncate text-xl font-extrabold leading-tight text-white transition-colors hover:text-[var(--color-foreground-secondary)]"
              >
                {activeStream.channelDisplayName}
              </Link>
              <span
                className={cn("hidden items-center gap-1 text-xs font-bold sm:flex", platformColor)}
              >
                <PlatformIcon size={14} />
                <span className="capitalize">{activeStream.platform}</span>
              </span>
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <p className="min-w-0 truncate text-sm font-extrabold uppercase leading-tight text-white">
                {activeStream.title}
              </p>
              <div className="hidden shrink-0 items-center gap-1 md:flex">
                {showTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[var(--color-tag-bg)] px-2.5 py-1 text-xs font-bold leading-none text-[var(--color-tag-text)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <Link
            to="/stream/$platform/$channel"
            params={{ platform: activeStream.platform, channel: activeStream.channelName }}
            search={{ tab: "home" }}
            className={cn(
              "hidden h-9 shrink-0 items-center rounded-md px-4 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:inline-flex",
              watchNowClassName
            )}
          >
            {t("home.watchNow")}
          </Link>
        </div>

        {hasMultipleSlides && (
          <div className="mt-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {carouselStreams.map((carouselStream, index) => (
                <button
                  key={`${carouselStream.platform}-${carouselStream.id}`}
                  type="button"
                  className={cn(
                    "h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                    index === activeIndex ? "w-12 bg-white" : "w-2 bg-white/35 hover:bg-white/70"
                  )}
                  aria-label={t("home.showChannel", {
                    channel: carouselStream.channelDisplayName,
                  })}
                  aria-current={index === activeIndex ? "true" : undefined}
                  onClick={() => changeActiveIndex(index)}
                />
              ))}
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center text-white transition-colors hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={t("home.previousFeatured")}
                onClick={goToPrevious}
              >
                <LuChevronLeft className="h-8 w-8" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center text-white transition-colors hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={t("home.nextFeatured")}
                onClick={goToNext}
              >
                <LuChevronRight className="h-8 w-8" />
              </button>
            </div>
          </div>
        )}
        <div className="mt-4 sm:hidden">
          <Link
            to="/stream/$platform/$channel"
            params={{ platform: activeStream.platform, channel: activeStream.channelName }}
            search={{ tab: "home" }}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-4 text-sm font-extrabold",
              watchNowClassName
            )}
          >
            {t("home.watchNow")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function FeaturedStreamPreview({
  stream,
  muted,
  volume,
  onUnavailable,
}: {
  stream: UnifiedStream;
  muted: boolean;
  volume: number;
  onUnavailable: () => void;
}) {
  const { playback } = useStreamPlayback(stream.platform, stream.channelName);

  if (!playback?.url) return null;

  return (
    <FeaturedStreamPreviewPlayer
      key={`${stream.platform}-${stream.channelName}-${playback.url}`}
      platform={stream.platform}
      channelName={stream.channelName}
      url={playback.url}
      muted={muted}
      volume={volume}
      onUnavailable={onUnavailable}
    />
  );
}

function FeaturedStreamPreviewPlayer({
  platform,
  channelName,
  url,
  muted,
  volume,
  onUnavailable,
}: {
  platform: UnifiedStream["platform"];
  channelName: string;
  url: string;
  muted: boolean;
  volume: number;
  onUnavailable: () => void;
}) {
  const enableAdBlock = useAdBlockStore((state) => state.enableAdBlock);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const previewClassName = cn(
    "absolute inset-0 size-full object-cover transition-opacity duration-300 motion-reduce:transition-none",
    isPreviewReady ? "opacity-100" : "opacity-0"
  );

  if (platform === "twitch") {
    return (
      <TwitchHlsPlayer
        src={url}
        channelName={channelName}
        enableAdBlock={enableAdBlock}
        autoPlay={true}
        muted={muted}
        volume={volume}
        preferredQuality="360p"
        controls={false}
        aria-hidden="true"
        tabIndex={-1}
        className={previewClassName}
        onPlaying={() => setIsPreviewReady(true)}
        onError={() => {
          setIsPreviewReady(false);
          onUnavailable();
        }}
      />
    );
  }

  return (
    <HlsPlayer
      src={url}
      autoPlay={true}
      muted={muted}
      volume={volume}
      isLive={true}
      aria-hidden="true"
      tabIndex={-1}
      preferredQuality="360p"
      controls={false}
      className={previewClassName}
      onPlaying={() => setIsPreviewReady(true)}
      onError={() => {
        setIsPreviewReady(false);
        onUnavailable();
      }}
    />
  );
}
