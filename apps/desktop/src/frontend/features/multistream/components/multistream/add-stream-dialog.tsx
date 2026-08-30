import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  LuCircleAlert,
  LuMonitorPlay,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuStar,
} from "react-icons/lu";

import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import { UnifiedSearchInput } from "@/features/discovery/components/search/UnifiedSearchInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useLiveFavoriteStreams } from "@/features/discovery/data/queries/useLiveFavoriteStreams";
import { STREAM_KEYS } from "@/features/discovery/data/queries/useStreams";
import { cn } from "@/lib/utils";
import type { Platform } from "@shared/auth-types";
import {
  type FavoriteStreamRef,
  useMultiStreamStore,
} from "@/features/multistream/data/multistream-store";

type DialogTab = "search" | "favorites";

const TABS: { id: DialogTab; label: string; icon: typeof LuSearch }[] = [
  { id: "search", label: "Search", icon: LuSearch },
  { id: "favorites", label: "Favorites", icon: LuStar },
];

function favoriteFromChannel(channel: UnifiedChannel): FavoriteStreamRef {
  return {
    platform: channel.platform,
    channelId: channel.id,
    channelName: channel.username,
    displayName: channel.displayName,
    avatarUrl: channel.avatarUrl,
  };
}

function favoriteFromStream(stream: UnifiedStream): FavoriteStreamRef {
  return {
    platform: stream.platform,
    channelId: stream.channelId,
    channelName: stream.channelName,
    displayName: stream.channelDisplayName,
    avatarUrl: stream.channelAvatar,
  };
}

export function AddStreamDialog() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DialogTab>("search");
  const [resetKey, setResetKey] = useState(0);
  const [status, setStatus] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null!);
  const tabRefs = useRef<Record<DialogTab, HTMLButtonElement | null>>({
    search: null,
    favorites: null,
  });
  const queryClient = useQueryClient();

  const addStream = useMultiStreamStore((state) => state.addStream);
  const streams = useMultiStreamStore((state) => state.streams);
  const multiviewCap = useMultiStreamStore((state) => state.multiviewCap);
  const favoriteStreams = useMultiStreamStore((state) => state.favoriteStreams);
  const toggleFavorite = useMultiStreamStore((state) => state.toggleFavorite);
  const isFavorite = useMultiStreamStore((state) => state.isFavorite);
  const liveFavorites = useLiveFavoriteStreams();

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setActiveTab("search");
      setStatus("");
    }
  };

  const tryAddStream = (nextPlatform: Platform, channelName: string, refocusSearch = false) => {
    const normalizedName = channelName.trim();
    if (!normalizedName) return;

    if (streams.length >= multiviewCap) {
      setStatus(
        `Layout is full. Remove a stream before adding another (${streams.length}/${multiviewCap}).`
      );
      if (refocusSearch) queueMicrotask(() => searchInputRef.current?.focus());
      return;
    }

    const streamId = `${nextPlatform}-${normalizedName}`;
    if (streams.some((stream) => stream.id === streamId)) {
      setStatus(`${normalizedName} is already in this layout.`);
      if (refocusSearch) queueMicrotask(() => searchInputRef.current?.focus());
      return;
    }

    addStream(nextPlatform, normalizedName);
    setStatus("");
    setResetKey((key) => key + 1);
    setOpen(false);
  };

  const selectTab = (tab: DialogTab, focus = false) => {
    setActiveTab(tab);
    setStatus("");
    if (focus) queueMicrotask(() => tabRefs.current[tab]?.focus());
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: DialogTab) => {
    const index = TABS.findIndex((candidate) => candidate.id === tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(TABS[nextIndex].id, true);
  };

  const retryFavoriteQueries = () => {
    void Promise.all(
      favoriteStreams.map((favorite) =>
        queryClient.refetchQueries({
          queryKey: STREAM_KEYS.byChannel(favorite.channelName, favorite.platform),
          exact: true,
        })
      )
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 font-bold">
          <LuPlus className="h-4 w-4" />
          Add Stream
        </Button>
      </DialogTrigger>

      <DialogContent className="gap-0 overflow-visible border-[var(--color-border)] bg-[var(--color-background)] p-0 shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] sm:max-w-[540px]">
        <DialogHeader className="border-b border-[var(--color-border)] px-6 pb-5 pt-6">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <LuMonitorPlay className="h-5 w-5" />
            Add Stream to Layout
          </DialogTitle>
          <DialogDescription className="pr-8 text-[var(--color-foreground-secondary)]">
            Find a live channel or choose one from your saved favorites.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Add stream source"
          className="grid grid-cols-2 gap-1 border-b border-[var(--color-border)] bg-[var(--color-background-secondary)] p-1.5"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[tab.id] = node;
                }}
                id={`add-stream-${tab.id}-tab`}
                type="button"
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-controls={`add-stream-${tab.id}-panel`}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                  selected
                    ? "bg-[var(--color-background-elevated)] text-white"
                    : "text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-tertiary)] hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="px-6 py-5">
          <section
            id="add-stream-search-panel"
            role="tabpanel"
            aria-labelledby="add-stream-search-tab"
            hidden={activeTab !== "search"}
            className="space-y-5"
          >
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-foreground-secondary)]">
                Live channel
              </span>
              <UnifiedSearchInput
                key={resetKey}
                inputRef={searchInputRef}
                onSelectChannel={(channel) =>
                  tryAddStream(channel.platform, channel.username, true)
                }
                showCategories={false}
                liveOnlyChannels
                isChannelFavorite={(channel) => isFavorite(favoriteFromChannel(channel))}
                onToggleChannelFavorite={(channel) => toggleFavorite(favoriteFromChannel(channel))}
                placeholder="Search live Twitch and Kick channels..."
                inputClassName="h-11 rounded-lg border-[var(--color-border)] bg-[var(--color-background-secondary)] text-sm font-medium text-white focus:ring-2 focus:ring-[var(--color-ring)]"
                className="w-full"
                autoFocus
              />
              <p className="text-xs text-[var(--color-foreground-muted)]">
                Select a result to add it. The star saves it for later.
              </p>
            </div>
          </section>

          <section
            id="add-stream-favorites-panel"
            role="tabpanel"
            aria-labelledby="add-stream-favorites-tab"
            hidden={activeTab !== "favorites"}
            className="min-h-48"
          >
            {liveFavorites.isLoading && (
              <div className="space-y-2" aria-label="Loading live favorites">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-14 animate-pulse rounded-lg bg-[var(--color-background-secondary)]"
                  />
                ))}
              </div>
            )}

            {liveFavorites.error && (
              <div className="mb-3 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-3 text-sm">
                <LuCircleAlert className="h-4 w-4 shrink-0 text-[var(--color-foreground-secondary)]" />
                <p className="min-w-0 flex-1 text-[var(--color-foreground-secondary)]">
                  Couldn&apos;t refresh every favorite.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={retryFavoriteQueries}
                >
                  <LuRefreshCw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            )}

            {!liveFavorites.isLoading &&
              !liveFavorites.error &&
              liveFavorites.streams.length === 0 && (
                <div className="flex min-h-48 flex-col items-center justify-center text-center">
                  <LuStar className="mb-3 h-6 w-6 text-[var(--color-foreground-muted)]" />
                  <p className="text-sm font-semibold text-white">No live favorites</p>
                  <p className="mt-1 max-w-xs text-xs text-[var(--color-foreground-muted)]">
                    Star channels in Search. They&apos;ll appear here whenever they go live.
                  </p>
                </div>
              )}

            {liveFavorites.streams.length > 0 && (
              <div className="space-y-1">
                {liveFavorites.streams.map((stream) => {
                  const favorite = favoriteFromStream(stream);
                  return (
                    <div
                      key={`${stream.platform}-${stream.channelId}`}
                      className="flex items-stretch rounded-lg transition-colors hover:bg-[var(--color-background-secondary)]"
                    >
                      <button
                        type="button"
                        onClick={() => tryAddStream(stream.platform, stream.channelName)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]"
                      >
                        <ProxiedImage
                          src={stream.channelAvatar}
                          alt={stream.channelDisplayName}
                          className="h-10 w-10 shrink-0 rounded-full object-cover"
                          fallbackClassName="h-10 w-10 shrink-0 rounded-full text-sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white">
                            {stream.channelDisplayName}
                          </span>
                          <span className="block truncate text-xs text-[var(--color-foreground-secondary)]">
                            {stream.categoryName || stream.title}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-[var(--color-foreground-secondary)]">
                          {stream.viewerCount.toLocaleString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-pressed="true"
                        aria-label={`Remove ${stream.channelDisplayName} from favorites`}
                        onClick={() => toggleFavorite(favorite)}
                        className="m-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--color-background-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                      >
                        <LuStar className="h-4 w-4 fill-current" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--color-border)] px-6 py-3 text-xs text-[var(--color-foreground-muted)]">
          <span>
            {streams.length} / {multiviewCap} streams
          </span>
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="min-h-4 text-right text-[var(--color-foreground-secondary)]"
          >
            {status}
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
