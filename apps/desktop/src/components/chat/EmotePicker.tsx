/**
 * EmotePicker Component
 *
 * A searchable emote picker with categories for different providers.
 * Features tabs for switching between providers, search, and recent emotes.
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Emote, EmoteProvider } from "../../backend/services/emotes/emote-types";
import type { ChatPlatform } from "../../shared/chat-types";
import { useEmoteStore } from "../../store/emote-store";
import { EmoteImage } from "./EmoteImage";

interface EmotePickerProps {
  /** Called when an emote is selected */
  onSelect: (emote: Emote) => void;
  /** Whether the picker is visible */
  isOpen: boolean;
  /** Called when the picker should close */
  onClose: () => void;
  /** Position of the picker */
  position?: "top" | "bottom";
  /** Additional class name */
  className?: string;
  /** Current platform */
  platform?: ChatPlatform;
}

/** Available tabs in the emote picker */
type EmoteTab = "recent" | "favorites" | "twitch" | "kick" | "bttv" | "ffz" | "7tv";

/** Tab configuration */
const TABS: Array<{ id: EmoteTab; label: string; icon: string }> = [
  { id: "recent", label: "Recent", icon: "🕐" },
  { id: "favorites", label: "Favorites", icon: "⭐" },
  { id: "twitch", label: "Twitch", icon: "📺" },
  { id: "kick", label: "Kick", icon: "🟢" },
  { id: "bttv", label: "BTTV", icon: "🅱️" },
  { id: "ffz", label: "FFZ", icon: "🎭" },
  { id: "7tv", label: "7TV", icon: "7️⃣" },
];

/** Provider colors for styling */
const _PROVIDER_COLORS: Record<EmoteProvider, string> = {
  twitch: "#9146FF",
  kick: "#53FC18",
  bttv: "#D50014",
  ffz: "#5D8FBC",
  "7tv": "#29B6F6",
};

// Filter tabs based on platform
const getTabsForPlatform = (platform: "twitch" | "kick"): typeof TABS => {
  const commonTabs = TABS.filter((t) => t.id === "recent" || t.id === "favorites");

  if (platform === "twitch") {
    const twitchTabs = TABS.filter(
      (t) => t.id === "twitch" || t.id === "bttv" || t.id === "ffz" || t.id === "7tv"
    );
    return [...commonTabs, ...twitchTabs];
  } else {
    // Kick
    const kickTabs = TABS.filter((t) => t.id === "kick" || t.id === "7tv");
    return [...commonTabs, ...kickTabs];
  }
};

export const EmotePicker: React.FC<EmotePickerProps> = ({
  onSelect,
  isOpen,
  onClose,
  position = "top",
  className = "",
  platform = "twitch",
}) => {
  const [activeTab, setActiveTab] = useState<EmoteTab>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Get available tabs based on platform
  const availableTabs = useMemo(() => getTabsForPlatform(platform), [platform]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { recentEmotes, favoriteEmotes, isLoading, activeChannelId, loadedChannels, globalEmotesLoaded } =
    useEmoteStore(
      useShallow((state) => ({
        recentEmotes: state.recentEmotes,
        favoriteEmotes: state.favoriteEmotes,
        isLoading: state.isLoading,
        activeChannelId: state.activeChannelId,
        loadedChannels: state.loadedChannels,
        globalEmotesLoaded: state.globalEmotesLoaded,
      }))
    );
  const addRecentEmote = useEmoteStore((state) => state.addRecentEmote);
  const toggleFavorite = useEmoteStore((state) => state.toggleFavorite);
  const isFavorite = useEmoteStore((state) => state.isFavorite);
  const searchEmotes = useEmoteStore((state) => state.searchEmotes);
  const getEmotesByProvider = useEmoteStore((state) => state.getEmotesByProvider);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Get emotes for current tab. Depends on emote-manager state — tracked via
  // store fields that change when emotes load/unload (activeChannelId / loadedChannels / globalEmotesLoaded).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const emotesByProvider = useMemo(() => getEmotesByProvider(), [
    activeChannelId,
    loadedChannels,
    globalEmotesLoaded,
  ]);

  // Get displayed emotes based on active tab and search. searchEmotes() and getEmotesByProvider()
  // are stable store-action refs (Zustand v5); we deliberately depend on the underlying state instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const displayedEmotes = useMemo(() => {
    // If searching, return search results
    if (searchQuery.trim()) {
      return searchEmotes(searchQuery, 50);
    }

    // Otherwise, return emotes for the current tab
    switch (activeTab) {
      case "recent":
        return recentEmotes;
      case "favorites":
        return favoriteEmotes;
      case "twitch":
        return emotesByProvider.get("twitch") || [];
      case "kick":
        return emotesByProvider.get("kick") || [];
      case "bttv":
        return emotesByProvider.get("bttv") || [];
      case "ffz":
        return emotesByProvider.get("ffz") || [];
      case "7tv":
        return emotesByProvider.get("7tv") || [];
      default:
        return [];
    }
  }, [
    activeTab,
    searchQuery,
    recentEmotes,
    favoriteEmotes,
    emotesByProvider,
    activeChannelId,
    loadedChannels,
    globalEmotesLoaded,
  ]);

  // Handle emote selection
  const handleEmoteClick = useCallback(
    (emote: Emote) => {
      addRecentEmote(emote);
      onSelect(emote);
    },
    [onSelect, addRecentEmote]
  );

  // Handle favorite toggle (prevent selection)
  const handleFavoriteClick = useCallback(
    (e: React.MouseEvent, emote: Emote) => {
      e.stopPropagation();
      toggleFavorite(emote);
    },
    [toggleFavorite]
  );

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className={`absolute ${
        position === "top" ? "bottom-full mb-2" : "top-full mt-2"
      } left-0 right-0 bg-[var(--color-background-secondary)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 overflow-hidden ${className}`}
      style={{ maxHeight: "360px" }}
    >
      {/* Search Bar */}
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search emotes..."
            className="w-full h-9 pl-9 pr-3 rounded-md bg-[var(--color-background-tertiary)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-1 focus:ring-white placeholder-[var(--color-foreground-muted)]"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
            >
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {!searchQuery && (
        <div className="flex overflow-x-auto border-b border-[var(--color-border)] scrollbar-hide">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-white/10 text-white border-b-2 border-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Emote Grid */}
      <div className="p-2 overflow-y-auto" style={{ maxHeight: "240px" }}>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent" />
          </div>
        )}

        {!isLoading && displayedEmotes.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            {searchQuery ? (
              <p>No emotes found for &quot;{searchQuery}&quot;</p>
            ) : activeTab === "recent" ? (
              <p>No recent emotes yet</p>
            ) : activeTab === "favorites" ? (
              <p>No favorite emotes yet</p>
            ) : (
              <p>No emotes available</p>
            )}
          </div>
        )}

        {!isLoading && displayedEmotes.length > 0 && (
          <div className="grid grid-cols-8 gap-1">
            {displayedEmotes.map((emote) => (
              <EmoteGridItem
                key={`${emote.provider}-${emote.id}`}
                emote={emote}
                isFavorite={isFavorite(emote.id)}
                onClick={() => handleEmoteClick(emote)}
                onFavoriteClick={(e) => handleFavoriteClick(e, emote)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with emote count */}
      <div className="px-3 py-2 border-t border-[var(--color-border)] text-xs text-gray-500 flex justify-between">
        <span>
          {searchQuery ? "Search results" : availableTabs.find((t) => t.id === activeTab)?.label}
        </span>
        <span>{displayedEmotes.length} emotes</span>
      </div>
    </div>
  );
};

/** Individual emote grid item */
interface EmoteGridItemProps {
  emote: Emote;
  isFavorite: boolean;
  onClick: () => void;
  onFavoriteClick: (e: React.MouseEvent) => void;
}

const EmoteGridItem: React.FC<EmoteGridItemProps> = ({
  emote,
  isFavorite,
  onClick,
  onFavoriteClick,
}) => {
  const [showFavButton, setShowFavButton] = useState(false);

  return (
    <div
      className="relative group flex items-center justify-center p-1 rounded-md hover:bg-white/10 cursor-pointer transition-colors"
      onClick={onClick}
      onMouseEnter={() => setShowFavButton(true)}
      onMouseLeave={() => setShowFavButton(false)}
      title={emote.name}
    >
      <EmoteImage emote={emote} size="medium" showTooltip={false} lazyLoad={true} />

      {/* Favorite button overlay */}
      {showFavButton && (
        <button
          onClick={onFavoriteClick}
          className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs ${
            isFavorite ? "bg-yellow-500 text-black" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
          }`}
        >
          ★
        </button>
      )}
    </div>
  );
};

export default EmotePicker;
