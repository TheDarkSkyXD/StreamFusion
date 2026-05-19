/**
 * EmoteDialog Component
 *
 * Reusable anchored-popover dialog used by both native and third-party emote buttons.
 * Translates KickTalk's EmoteDialogs.jsx pattern: search bar, sub-section icon row,
 * pinned Recent/Favorites, collapsible provider sections with IntersectionObserver
 * infinite scroll, and Kick subscriber-only lock overlay.
 */

import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import type { Emote, EmoteProvider } from "../../backend/services/emotes/emote-types";
import { useEmoteStore } from "../../store/emote-store";
import { EmoteImage } from "./EmoteImage";

export type EmoteDialogScope = "native" | "thirdParty";
export type EmoteDialogPlatform = "twitch" | "kick";

interface EmoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emote: Emote) => void;
  anchorRef: React.RefObject<HTMLElement>;
  scope: EmoteDialogScope;
  platform: EmoteDialogPlatform;
  channelId?: string | null;
  /**
   * Only consulted by Kick-native. `undefined` = unknown → no lock overlay.
   * `false` + emote.subscribersOnly === true → lock overlay.
   */
  viewerIsSubscribed?: boolean;
}

/**
 * Sub-section identifier for the icon row beneath the search bar. Semantics
 * differ per scope/platform:
 *   - native twitch: "channel" | "global"
 *   - native kick:   "channel" | "global" | "emoji"
 *   - thirdParty twitch: "7tv" | "bttv" | "ffz"
 *   - thirdParty kick:   "channel" | "global"
 */
type SubSection = "channel" | "global" | "emoji" | "7tv" | "bttv" | "ffz";

interface SubSectionConfig {
  id: SubSection;
  label: string;
  icon: React.ReactNode;
}

/** Compute the providers covered by a given scope+platform. */
function getProvidersForScope(
  scope: EmoteDialogScope,
  platform: EmoteDialogPlatform
): EmoteProvider[] {
  if (scope === "native") {
    return platform === "twitch" ? ["twitch"] : ["kick"];
  }
  // thirdParty
  return platform === "twitch" ? ["7tv", "bttv", "ffz"] : ["7tv"];
}

const GlobeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    width={18}
    height={18}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 010 18M12 3a14 14 0 000 18M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const ChannelIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    width={18}
    height={18}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5.121 17.804A13.937 13.937 0 0112 16c2.486 0 4.797.71 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const EmojiIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    width={18}
    height={18}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const LockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="currentColor"
    viewBox="0 0 24 24"
    width={14}
    height={14}
  >
    <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z" />
  </svg>
);

const CaretIcon: React.FC<{ className?: string; open: boolean }> = ({
  className,
  open,
}) => (
  <svg
    className={`${className ?? ""} transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
    fill="currentColor"
    viewBox="0 0 24 24"
    width={14}
    height={14}
  >
    <path d="M7 10l5 5 5-5H7z" />
  </svg>
);

const StarIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    width={12}
    height={12}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.852 5.702a1 1 0 00.95.69h5.992c.969 0 1.371 1.24.588 1.81l-4.847 3.522a1 1 0 00-.363 1.118l1.852 5.702c.3.921-.755 1.688-1.539 1.118l-4.847-3.522a1 1 0 00-1.176 0l-4.847 3.522c-.784.57-1.838-.197-1.539-1.118l1.852-5.702a1 1 0 00-.363-1.118L2.272 11.13c-.783-.57-.381-1.81.588-1.81h5.992a1 1 0 00.95-.69l1.852-5.702z"
    />
  </svg>
);

function getSubSectionsForScope(
  scope: EmoteDialogScope,
  platform: EmoteDialogPlatform
): SubSectionConfig[] {
  if (scope === "native" && platform === "twitch") {
    return [
      { id: "channel", label: "Channel", icon: <ChannelIcon /> },
      { id: "global", label: "Global", icon: <GlobeIcon /> },
    ];
  }
  if (scope === "native" && platform === "kick") {
    return [
      { id: "channel", label: "Channel", icon: <ChannelIcon /> },
      { id: "global", label: "Global", icon: <GlobeIcon /> },
      { id: "emoji", label: "Emojis", icon: <EmojiIcon /> },
    ];
  }
  if (scope === "thirdParty" && platform === "twitch") {
    return [
      { id: "7tv", label: "7TV", icon: <span className="font-bold text-xs">7TV</span> },
      { id: "bttv", label: "BTTV", icon: <span className="font-bold text-xs">B</span> },
      { id: "ffz", label: "FFZ", icon: <span className="font-bold text-xs">FFZ</span> },
    ];
  }
  // thirdParty kick
  return [
    { id: "channel", label: "Channel", icon: <ChannelIcon /> },
    { id: "global", label: "Global", icon: <GlobeIcon /> },
  ];
}

const PROVIDER_LABELS: Record<EmoteProvider, string> = {
  twitch: "Twitch",
  kick: "Kick",
  "7tv": "7TV",
  bttv: "BetterTTV",
  ffz: "FrankerFaceZ",
};

const PAGE_SIZE = 20;

/* ------------------------------------------------------------------------ */
/* Section                                                                  */
/* ------------------------------------------------------------------------ */

interface EmoteSectionProps {
  title: string;
  emotes: Emote[];
  collapsedHeaderOnly?: boolean;
  showLock: (emote: Emote) => boolean;
  onEmoteClick: (emote: Emote) => void;
  onFavoriteClick: (emote: Emote) => void;
  isFavorite: (emoteId: string) => boolean;
}

const EmoteSection: React.FC<EmoteSectionProps> = ({
  title,
  emotes,
  collapsedHeaderOnly = false,
  showLock,
  onEmoteClick,
  onFavoriteClick,
  isFavorite,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset visible count when emotes array shrinks.
  useEffect(() => {
    if (visibleCount > emotes.length) {
      setVisibleCount(Math.max(PAGE_SIZE, Math.min(visibleCount, emotes.length)));
    }
  }, [emotes.length, visibleCount]);

  useEffect(() => {
    if (!isOpen) return;
    if (collapsedHeaderOnly) return;
    if (visibleCount >= emotes.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, emotes.length));
        }
      },
      { threshold: 0.5, rootMargin: "20px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isOpen, collapsedHeaderOnly, emotes.length, visibleCount]);

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)] hover:bg-white/5"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <span>
          {title}
          {collapsedHeaderOnly && (
            <span className="ml-2 normal-case font-normal text-[var(--color-foreground-muted)]">
              ({emotes.length} match{emotes.length === 1 ? "" : "es"})
            </span>
          )}
        </span>
        <CaretIcon open={isOpen && !collapsedHeaderOnly} />
      </button>
      {isOpen && !collapsedHeaderOnly && (
        <div className="p-2">
          {emotes.length === 0 ? (
            <div className="text-center py-4 text-xs text-[var(--color-foreground-muted)]">
              No emotes
            </div>
          ) : (
            <>
              <div className="grid grid-cols-8 gap-1">
                {emotes.slice(0, visibleCount).map((emote) => (
                  <EmoteDialogItem
                    key={`${emote.provider}-${emote.id}`}
                    emote={emote}
                    locked={showLock(emote)}
                    favorited={isFavorite(emote.id)}
                    onSelect={onEmoteClick}
                    onFavoriteClick={onFavoriteClick}
                  />
                ))}
              </div>
              {visibleCount < emotes.length && (
                <div
                  ref={sentinelRef}
                  data-testid="emote-section-sentinel"
                  className="h-2 w-full"
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------------ */
/* Item                                                                     */
/* ------------------------------------------------------------------------ */

interface EmoteDialogItemProps {
  emote: Emote;
  locked: boolean;
  favorited: boolean;
  onSelect: (emote: Emote) => void;
  onFavoriteClick: (emote: Emote) => void;
}

const EmoteDialogItem: React.FC<EmoteDialogItemProps> = ({
  emote,
  locked,
  favorited,
  onSelect,
  onFavoriteClick,
}) => {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(() => {
    if (locked) return; // R9: locked emote click is a no-op
    onSelect(emote);
  }, [locked, onSelect, emote]);

  const handleFavorite = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onFavoriteClick(emote);
    },
    [onFavoriteClick, emote]
  );

  const ariaLabel = locked
    ? `${emote.name} — subscriber-only emote`
    : emote.name;

  return (
    <div
      className="relative group flex items-center justify-center p-1 rounded-md hover:bg-white/10 transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={emote.name}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        aria-disabled={locked ? "true" : undefined}
        className={`flex items-center justify-center w-full h-full ${
          locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        <EmoteImage emote={emote} size="medium" showTooltip={false} lazyLoad={true} />
        {locked && (
          <span
            data-testid="emote-lock-overlay"
            className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-md text-white pointer-events-none"
          >
            <LockIcon />
          </span>
        )}
      </button>
      {hovered && !locked && (
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={favorited ? `Unfavorite ${emote.name}` : `Favorite ${emote.name}`}
          className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${
            favorited
              ? "bg-yellow-500 text-black"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          <StarIcon filled={favorited} />
        </button>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------------ */
/* Main dialog                                                              */
/* ------------------------------------------------------------------------ */

export const EmoteDialog: React.FC<EmoteDialogProps> = ({
  isOpen,
  onClose,
  onSelect,
  anchorRef,
  scope,
  platform,
  channelId: _channelId,
  viewerIsSubscribed,
}) => {
  const providers = useMemo(
    () => getProvidersForScope(scope, platform),
    [scope, platform]
  );
  const subSections = useMemo(
    () => getSubSectionsForScope(scope, platform),
    [scope, platform]
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSubSection, setActiveSubSection] = useState<SubSection | null>(
    null
  );
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const {
    recentEmotes,
    favoriteEmotes,
    activeChannelId,
    loadedChannels,
    globalEmotesLoaded,
  } = useEmoteStore(
    useShallow((state) => ({
      recentEmotes: state.recentEmotes,
      favoriteEmotes: state.favoriteEmotes,
      activeChannelId: state.activeChannelId,
      loadedChannels: state.loadedChannels,
      globalEmotesLoaded: state.globalEmotesLoaded,
    }))
  );
  const addRecentEmote = useEmoteStore((state) => state.addRecentEmote);
  const toggleFavorite = useEmoteStore((state) => state.toggleFavorite);
  const isFavorite = useEmoteStore((state) => state.isFavorite);
  const getEmotesByProvider = useEmoteStore((state) => state.getEmotesByProvider);

  // Provider → emotes map. Recompute when underlying load state shifts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const emotesByProvider = useMemo(() => getEmotesByProvider(), [
    activeChannelId,
    loadedChannels,
    globalEmotesLoaded,
  ]);

  /* --------------------------- focus on open --------------------------- */
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  /* ---------------------------- positioning ---------------------------- */
  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const dialog = containerRef.current;
      const dialogWidth = dialog?.offsetWidth ?? 360;
      const dialogHeight = dialog?.offsetHeight ?? 400;

      // Right-aligned to anchor, above the anchor.
      let left = rect.right - dialogWidth;
      let top = rect.top - dialogHeight - 8;

      // Viewport clamp.
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (left < margin) left = margin;
      if (left + dialogWidth > vw - margin) left = vw - dialogWidth - margin;
      if (top < margin) top = rect.bottom + 8; // flip below
      if (top + dialogHeight > vh - margin) top = vh - dialogHeight - margin;

      setPosition({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, anchorRef]);

  /* ----------------------- outside click / Escape ---------------------- */
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && containerRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  /* ------------------------- helpers / filters ------------------------- */
  const inScope = useCallback(
    (emote: Emote) => providers.includes(emote.provider),
    [providers]
  );

  const matchesSearch = useCallback(
    (emote: Emote) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return emote.name.toLowerCase().includes(q);
    },
    [searchQuery]
  );

  /**
   * Apply the active sub-section filter to emotes belonging to a specific
   * provider. Sub-section semantics:
   *   - "channel" → emote.isGlobal === false
   *   - "global"  → emote.isGlobal === true
   *   - "emoji"   → kick emojis. We do not have a distinct emoji flag in the
   *                 emote type today; we approximate by keeping all kick
   *                 globals. (Plan does not require precise separation.)
   *   - "7tv" | "bttv" | "ffz" → already handled at the provider level.
   */
  const applySubSectionFilter = useCallback(
    (emote: Emote): boolean => {
      if (!activeSubSection) return true;
      if (
        activeSubSection === "7tv" ||
        activeSubSection === "bttv" ||
        activeSubSection === "ffz"
      ) {
        return emote.provider === activeSubSection;
      }
      if (activeSubSection === "channel") return emote.isGlobal === false;
      if (activeSubSection === "global") return emote.isGlobal === true;
      if (activeSubSection === "emoji") return emote.isGlobal === true;
      return true;
    },
    [activeSubSection]
  );

  /* ---------------------------- pinned ---------------------------- */
  const recentInScope = useMemo(
    () => recentEmotes.filter((e) => inScope(e) && matchesSearch(e)),
    [recentEmotes, inScope, matchesSearch]
  );
  const favoritesInScope = useMemo(
    () => favoriteEmotes.filter((e) => inScope(e) && matchesSearch(e)),
    [favoriteEmotes, inScope, matchesSearch]
  );

  /* ----------------------- per-provider lists ---------------------- */
  const providerLists = useMemo(() => {
    return providers
      .filter((provider) => {
        // Sub-section icon filter only restricts the lower (provider) sections.
        if (
          activeSubSection === "7tv" ||
          activeSubSection === "bttv" ||
          activeSubSection === "ffz"
        ) {
          return provider === activeSubSection;
        }
        return true;
      })
      .map((provider) => {
        const all = emotesByProvider.get(provider) ?? [];
        const filtered = all
          .filter((e) => matchesSearch(e))
          .filter((e) => applySubSectionFilter(e));
        return { provider, emotes: filtered };
      });
  }, [providers, activeSubSection, emotesByProvider, matchesSearch, applySubSectionFilter]);

  /* ----------------------------- handlers ---------------------------- */
  const handleEmoteClick = useCallback(
    (emote: Emote) => {
      addRecentEmote(emote);
      onSelect(emote);
    },
    [addRecentEmote, onSelect]
  );

  const handleSubSectionClick = useCallback((id: SubSection) => {
    setActiveSubSection((cur) => (cur === id ? null : id));
  }, []);

  /* --------------------------- lock predicate --------------------------- */
  const showLock = useCallback(
    (emote: Emote): boolean => {
      if (!(scope === "native" && platform === "kick")) return false;
      if (viewerIsSubscribed === undefined) return false;
      if (viewerIsSubscribed === true) return false;
      return emote.subscribersOnly === true;
    },
    [scope, platform, viewerIsSubscribed]
  );

  if (!isOpen) return null;

  const searching = searchQuery.trim().length > 0;

  return (
    <div
      ref={containerRef}
      data-testid="emote-dialog"
      role="dialog"
      aria-label={`${platform} ${scope} emote picker`}
      className="fixed z-50 w-[360px] max-h-[480px] flex flex-col bg-[var(--color-background-secondary)] border border-[var(--color-border)] rounded-lg shadow-xl overflow-hidden"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
      }}
    >
      {/* Search */}
      <div className="p-2 border-b border-[var(--color-border)]">
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search emotes..."
          className="w-full h-9 px-3 rounded-md bg-[var(--color-background-tertiary)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-1 focus:ring-white placeholder-[var(--color-foreground-muted)]"
        />
      </div>

      {/* Sub-section icon row */}
      {subSections.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
          {subSections.map((sub) => {
            const active = activeSubSection === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => handleSubSectionClick(sub.id)}
                aria-pressed={active}
                aria-label={sub.label}
                title={sub.label}
                className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-[var(--color-foreground-muted)] hover:bg-white/5 hover:text-white"
                }`}
              >
                {sub.icon}
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <EmoteSection
          title="Recent"
          emotes={recentInScope}
          collapsedHeaderOnly={searching}
          showLock={showLock}
          onEmoteClick={handleEmoteClick}
          onFavoriteClick={toggleFavorite}
          isFavorite={isFavorite}
        />
        <EmoteSection
          title="Favorites"
          emotes={favoritesInScope}
          collapsedHeaderOnly={searching}
          showLock={showLock}
          onEmoteClick={handleEmoteClick}
          onFavoriteClick={toggleFavorite}
          isFavorite={isFavorite}
        />
        {providerLists.map(({ provider, emotes }) => (
          <EmoteSection
            key={provider}
            title={PROVIDER_LABELS[provider]}
            emotes={emotes}
            showLock={showLock}
            onEmoteClick={handleEmoteClick}
            onFavoriteClick={toggleFavorite}
            isFavorite={isFavorite}
          />
        ))}
      </div>
    </div>
  );
};

export default EmoteDialog;
