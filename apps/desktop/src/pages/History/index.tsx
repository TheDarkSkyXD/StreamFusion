import { Link } from "@tanstack/react-router";
import type React from "react";
import { LuHistory as HistoryIcon, LuPlay, LuTrash2 } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import { type HistoryItem, useHistoryStore } from "@/store/history-store";

const HistoryItemLink = ({
  item,
  children,
  className,
}: {
  item: HistoryItem;
  children: React.ReactNode;
  className?: string;
}) => {
  if (item.type === "video") {
    return (
      <Link
        to="/video/$platform/$videoId"
        params={{ platform: item.platform, videoId: item.originalId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (item.type === "clip") {
    return (
      <Link
        to="/stream/$platform/$channel"
        params={{ platform: item.platform, channel: item.channelName }}
        search={{ tab: "clips" }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      to="/stream/$platform/$channel"
      params={{ platform: item.platform, channel: item.channelName }}
      search={{ tab: "home" }}
      className={className}
    >
      {children}
    </Link>
  );
};

export function HistoryPage() {
  const { history, clearHistory, removeFromHistory } = useHistoryStore();

  const handleClearHistory = () => {
    if (confirm("Are you sure you want to clear your watch history?")) {
      clearHistory();
    }
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(new Date(timestamp));
  };

  return (
    <div className="p-6 max-w-[1800px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HistoryIcon className="w-8 h-8 text-[var(--color-primary)]" />
          <h1 className="text-3xl font-bold">Watch History</h1>
        </div>
        {history.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearHistory}
            className="flex items-center gap-2"
          >
            <LuTrash2 className="w-4 h-4" />
            Clear History
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-20 text-[var(--color-foreground-secondary)]">
          <HistoryIcon className="w-16 h-16 mb-4 opacity-20" />
          <h2 className="text-xl font-semibold mb-2">No watch history yet</h2>
          <p>Videos and clips you watch will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {history.map((item) => (
            <div
              key={item.id}
              className="group relative bg-[var(--color-background-secondary)] rounded-lg overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-all"
            >
              {/* Thumbnail Container */}
              <div className="relative aspect-video bg-black/50">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                    <LuPlay className="w-8 h-8 text-white/20" />
                  </div>
                )}

                {/* Overlay on hover */}
                <div className="hidden group-hover:flex absolute inset-0 bg-black/40 items-center justify-center transition-opacity">
                  <HistoryItemLink
                    item={item}
                    className="text-white bg-[var(--color-primary)] p-3 rounded-full hover:bg-[var(--color-primary-dark)] transform scale-100 hover:scale-110 transition-transform"
                  >
                    <LuPlay className="w-6 h-6 fill-current" />
                  </HistoryItemLink>
                </div>

                {/* Platform Badge */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-bold uppercase text-white bg-black/60 backdrop-blur-sm">
                  {item.platform}
                </div>

                {/* Type Badge */}
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-bold uppercase text-white bg-[var(--color-primary)]">
                  {item.type}
                </div>

                {/* Remove Button */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeFromHistory(item.id);
                  }}
                  className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove from history"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Info */}
              <div className="p-3">
                <HistoryItemLink item={item} className="block">
                  <h3
                    className="font-medium text-sm line-clamp-2 mb-1 group-hover:text-[var(--color-primary)] transition-colors"
                    title={item.title}
                  >
                    {item.title || `Untitled ${item.type}`}
                  </h3>
                </HistoryItemLink>
                <div className="flex justify-between items-center text-xs text-[var(--color-foreground-secondary)]">
                  <span className="font-medium hover:text-[var(--color-foreground)] transition-colors">
                    {item.channelDisplayName || item.channelName}
                  </span>
                  <span>{formatDate(item.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
