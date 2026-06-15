/**
 * EmotePickerPopover Component
 *
 * Reusable anchored popover used by both native and third-party emote buttons.
 * Not a modal dialog — it portals to body and renders at `position: fixed`
 * anchored to an external ref, with no backdrop, no focus trap, and no
 * escape-to-close-modal semantics. The container therefore carries no
 * `role="dialog"`; `aria-label` is retained so screen readers can still
 * identify the picker. Translates KickTalk's emote picker pattern: search
 * bar, sub-section icon row, pinned Recent/Favorites, collapsible provider
 * sections with windowed emote grids, and Kick subscriber-only lock overlay.
 */

import type React from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { Emote, EmoteProvider } from "../../backend/services/emotes/emote-types";
import { useEmoteStore } from "../../store/emote-store";
import { KickIcon } from "../icons/PlatformIcons";
import { EmoteImage } from "./EmoteImage";

export type EmotePickerScope = "native" | "thirdParty";
export type EmotePickerPlatform = "twitch" | "kick";

interface EmotePickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emote: Emote) => void;
  anchorRef: React.RefObject<HTMLElement>;
  scope: EmotePickerScope;
  platform: EmotePickerPlatform;
  channelId?: string | null;
  /**
   * Only consulted by Kick-native. `undefined` = unknown → no lock overlay.
   * `false` + emote.subscribersOnly === true → lock overlay.
   */
  viewerIsSubscribed?: boolean;
  /**
   * Channel avatar URL. When provided, the "channel" sub-section icon shows the
   * streamer's profile picture instead of the generic person silhouette —
   * matches KickTalk's tab row where each section opens with its source's
   * recognizable mark.
   */
  channelAvatarUrl?: string | null;
  channelLabel?: string | null;
}

/**
 * Sub-section identifier for the icon row beneath the search bar. Semantics
 * differ per scope/platform:
 *   - native twitch: "channel" | "global"
 *   - native kick:   "channel" | "global" | "emoji"
 *   - thirdParty twitch: "7tv" | "bttv" | "ffz"
 *   - thirdParty kick:   "channel" | "global"
 */
type SubSection = "recent" | "channel" | "global" | "emoji" | "7tv" | "bttv" | "ffz";

interface SubSectionConfig {
  id: SubSection;
  label: string;
  icon: React.ReactNode;
  targetSectionId: string;
}

/** Compute the providers covered by a given scope+platform. */
function getProvidersForScope(
  scope: EmotePickerScope,
  platform: EmotePickerPlatform
): EmoteProvider[] {
  if (scope === "native") {
    return platform === "twitch" ? ["twitch"] : ["kick"];
  }
  // thirdParty
  return platform === "twitch" ? ["7tv", "bttv", "ffz"] : ["7tv"];
}

// KickTalk's globe-fill icon (src/renderer/src/assets/icons/globe-fill.svg) —
// filled solid-globe glyph with latitude/longitude relief carved out. Replaces
// the prior thin stroke globe so this tab row matches KickTalk visually.
const GlobeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="currentColor"
    viewBox="0 0 256 256"
    width={22}
    height={22}
    aria-hidden="true"
  >
    <path d="M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm78.36,64H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM216,128a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM128,43a115.27,115.27,0,0,1,26,45H102A115.11,115.11,0,0,1,128,43ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48Zm50.35,61.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z" />
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

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    width={18}
    height={18}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

// KickTalk's channel-tab thumbnail: the streamer's profile picture rendered as
// a 24×24 rounded square (matches `.dialogHeadMenuItem > img` size in
// reference/KickTalk-main `Input.scss`). Object-cover so non-square source
// images crop centered rather than squashing.
const ChannelAvatarIcon: React.FC<{ src: string }> = ({ src }) => (
  <img
    src={src}
    alt=""
    width={24}
    height={24}
    loading="lazy"
    decoding="async"
    className="w-6 h-6 rounded-[3px] object-cover"
  />
);

const LockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" width={14} height={14}>
    <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z" />
  </svg>
);

const CaretIcon: React.FC<{ className?: string; open: boolean }> = ({ className, open }) => (
  <svg
    className={`${className ?? ""} opacity-50 transition-[transform,opacity] duration-200 ease-in-out group-hover:opacity-100 ${open ? "rotate-180" : "rotate-0"}`}
    fill="none"
    viewBox="0 0 32 32"
    width={20}
    height={20}
    aria-hidden="true"
  >
    <path
      d="M27.0612 13.0615L17.0612 23.0615C16.9218 23.2013 16.7563 23.3123 16.5739 23.388C16.3916 23.4637 16.1961 23.5027 15.9987 23.5027C15.8013 23.5027 15.6058 23.4637 15.4235 23.388C15.2411 23.3123 15.0756 23.2013 14.9362 23.0615L4.9362 13.0615C4.6544 12.7797 4.49609 12.3975 4.49609 11.999C4.49609 11.6005 4.6544 11.2183 4.9362 10.9365C5.21799 10.6547 5.60018 10.4964 5.9987 10.4964C6.39721 10.4964 6.7794 10.6547 7.0612 10.9365L15.9999 19.8752L24.9387 10.9352C25.2205 10.6534 25.6027 10.4951 26.0012 10.4951C26.3997 10.4951 26.7819 10.6534 27.0637 10.9352C27.3455 11.217 27.5038 11.5992 27.5038 11.9977C27.5038 12.3962 27.3455 12.7784 27.0637 13.0602L27.0612 13.0615Z"
      fill="currentColor"
    />
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
  scope: EmotePickerScope,
  platform: EmotePickerPlatform,
  channelAvatarUrl?: string | null
): SubSectionConfig[] {
  const frequent: SubSectionConfig = {
    id: "recent",
    label: "Frequently Used",
    icon: <ClockIcon />,
    targetSectionId: "frequent",
  };
  const channelIcon = channelAvatarUrl ? (
    <ChannelAvatarIcon src={channelAvatarUrl} />
  ) : (
    <ChannelIcon />
  );

  if (scope === "native" && platform === "twitch") {
    return [
      frequent,
      { id: "channel", label: "Channel", icon: channelIcon, targetSectionId: "channel" },
      { id: "global", label: "Global", icon: <GlobeIcon />, targetSectionId: "global" },
    ];
  }
  if (scope === "native" && platform === "kick") {
    return [
      frequent,
      { id: "channel", label: "Channel", icon: channelIcon, targetSectionId: "channel" },
      { id: "global", label: "Global", icon: <GlobeIcon />, targetSectionId: "global" },
      { id: "emoji", label: "Emojis", icon: <KickIcon size={18} />, targetSectionId: "emoji" },
    ];
  }
  if (scope === "thirdParty" && platform === "twitch") {
    return [
      frequent,
      {
        id: "7tv",
        label: "7TV",
        icon: <span className="font-bold text-xs">7TV</span>,
        targetSectionId: "7tv",
      },
      {
        id: "bttv",
        label: "BTTV",
        icon: <span className="font-bold text-xs">B</span>,
        targetSectionId: "bttv",
      },
      {
        id: "ffz",
        label: "FFZ",
        icon: <span className="font-bold text-xs">FFZ</span>,
        targetSectionId: "ffz",
      },
    ];
  }
  // thirdParty kick
  return [
    frequent,
    { id: "channel", label: "Channel", icon: channelIcon, targetSectionId: "channel" },
    { id: "global", label: "Global", icon: <GlobeIcon />, targetSectionId: "global" },
  ];
}

const PROVIDER_LABELS: Record<EmoteProvider, string> = {
  twitch: "Twitch",
  kick: "Kick",
  "7tv": "7TV",
  bttv: "BetterTTV",
  ffz: "FrankerFaceZ",
};

function getKickEmoteSection(emote: Emote): "channel" | "global" | "emoji" {
  if (emote.kickSection) return emote.kickSection;
  return emote.isGlobal ? "global" : "channel";
}

const ITEM_SIZE_PX = 40;
const ITEM_GAP_PX = 8;
const ITEM_PITCH_PX = ITEM_SIZE_PX + ITEM_GAP_PX;
const DEFAULT_GRID_WIDTH_PX = 336;
const DEFAULT_PICKER_VIEWPORT_PX = 360;
const OVERSCAN_ROWS = 3;
const SCROLL_IDLE_DEFER_MS = 800;

function getColumnCount(width: number): number {
  return Math.max(1, Math.floor((width + ITEM_GAP_PX) / ITEM_PITCH_PX));
}

function getVisibleWindow({
  itemCount,
  columns,
  scrollTop,
  viewportHeight,
  gridOffsetTop,
}: {
  itemCount: number;
  columns: number;
  scrollTop: number;
  viewportHeight: number;
  gridOffsetTop: number;
}): { startIndex: number; endIndex: number; topSpacer: number; bottomSpacer: number } {
  const totalRows = Math.ceil(itemCount / columns);
  const totalHeight = totalRows * ITEM_PITCH_PX;
  const relativeTop = scrollTop - gridOffsetTop;
  const relativeBottom = relativeTop + viewportHeight;

  let startRow = 0;
  let endRow = totalRows;

  if (relativeBottom < 0) {
    startRow = 0;
    endRow = 0;
  } else if (relativeTop > totalHeight) {
    startRow = totalRows;
    endRow = totalRows;
  } else {
    startRow = Math.max(0, Math.floor(Math.max(0, relativeTop) / ITEM_PITCH_PX) - OVERSCAN_ROWS);
    endRow = Math.min(
      totalRows,
      Math.ceil((Math.max(0, relativeTop) + viewportHeight) / ITEM_PITCH_PX) + OVERSCAN_ROWS
    );
  }

  return {
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRow * columns),
    topSpacer: startRow * ITEM_PITCH_PX,
    bottomSpacer: Math.max(0, (totalRows - endRow) * ITEM_PITCH_PX),
  };
}

/* ------------------------------------------------------------------------ */
/* Section                                                                  */
/* ------------------------------------------------------------------------ */

interface EmoteSectionProps {
  sectionId: string;
  title: string;
  emotes: Emote[];
  collapsedHeaderOnly?: boolean;
  showLock: (emote: Emote) => boolean;
  onEmoteClick: (emote: Emote) => void;
  onFavoriteClick: (emote: Emote) => void;
  isFavorite: (emoteId: string) => boolean;
  deferImages?: boolean;
  scrollTop?: number;
  viewportHeight?: number;
  sectionRef?: (node: HTMLDivElement | null) => void;
}

const EmoteSection: React.FC<EmoteSectionProps> = ({
  sectionId,
  title,
  emotes,
  collapsedHeaderOnly = false,
  showLock,
  onEmoteClick,
  onFavoriteClick,
  isFavorite,
  deferImages = false,
  scrollTop = 0,
  viewportHeight = DEFAULT_PICKER_VIEWPORT_PX,
  sectionRef,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(() => getColumnCount(DEFAULT_GRID_WIDTH_PX));
  const [windowRange, setWindowRange] = useState(() =>
    getVisibleWindow({
      itemCount: emotes.length,
      columns: getColumnCount(DEFAULT_GRID_WIDTH_PX),
      scrollTop: 0,
      viewportHeight: DEFAULT_PICKER_VIEWPORT_PX,
      gridOffsetTop: 0,
    })
  );

  useEffect(() => {
    if (!isOpen) return;
    if (collapsedHeaderOnly) return;
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || DEFAULT_GRID_WIDTH_PX;
      setColumns(getColumnCount(width));
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [isOpen, collapsedHeaderOnly]);

  useLayoutEffect(() => {
    if (!isOpen || collapsedHeaderOnly) return;

    let raf: number | null = null;

    const updateWindow = () => {
      raf = null;
      setWindowRange(
        getVisibleWindow({
          itemCount: emotes.length,
          columns,
          scrollTop,
          viewportHeight,
          gridOffsetTop: bodyRef.current?.offsetTop ?? 0,
        })
      );
    };

    const scheduleUpdate = () => {
      if (raf != null) return;
      raf = window.requestAnimationFrame(updateWindow);
    };

    updateWindow();
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.removeEventListener("resize", scheduleUpdate);
      if (raf != null) window.cancelAnimationFrame(raf);
    };
  }, [isOpen, collapsedHeaderOnly, emotes.length, columns, scrollTop, viewportHeight]);

  const visibleEmotes = useMemo(
    () => emotes.slice(windowRange.startIndex, windowRange.endIndex),
    [emotes, windowRange.startIndex, windowRange.endIndex]
  );

  const gridStyle = useMemo<React.CSSProperties>(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${columns}, ${ITEM_SIZE_PX}px)`,
      gap: ITEM_GAP_PX,
      alignItems: "center",
      justifyContent: "start",
    }),
    [columns]
  );

  const needsWindowing = visibleEmotes.length < emotes.length;

  return (
    <div
      ref={sectionRef}
      data-emote-section-id={sectionId}
      className="border-b border-[var(--color-border)] last:border-b-0 scroll-mt-2"
    >
      <button
        type="button"
        className="group w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)] hover:bg-white/5"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <span className="text-[#777777]">
          {title}
          {collapsedHeaderOnly && (
            <span className="ml-2 normal-case font-normal text-[#777777]">
              ({emotes.length} match{emotes.length === 1 ? "" : "es"})
            </span>
          )}
        </span>
        <CaretIcon open={isOpen && !collapsedHeaderOnly} />
      </button>
      {isOpen && !collapsedHeaderOnly && (
        <div ref={bodyRef} className="p-3">
          {emotes.length === 0 ? (
            <div className="text-center py-4 text-xs text-[var(--color-foreground-muted)]">
              No emotes
            </div>
          ) : (
            <>
              {needsWindowing && <div style={{ height: windowRange.topSpacer }} />}
              <div
                ref={gridRef}
                data-testid="emote-section-grid"
                className="emote-picker-grid"
                style={gridStyle}
              >
                {visibleEmotes.map((emote) => (
                  <EmotePickerItem
                    key={`${emote.provider}-${emote.id}`}
                    emote={emote}
                    locked={showLock(emote)}
                    favorited={isFavorite(emote.id)}
                    deferImage={deferImages}
                    onSelect={onEmoteClick}
                    onFavoriteClick={onFavoriteClick}
                  />
                ))}
              </div>
              {needsWindowing && <div style={{ height: windowRange.bottomSpacer }} />}
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

interface EmotePickerItemProps {
  emote: Emote;
  locked: boolean;
  favorited: boolean;
  deferImage?: boolean;
  onSelect: (emote: Emote) => void;
  onFavoriteClick: (emote: Emote) => void;
}

const EmotePickerItem = memo(function EmotePickerItem({
  emote,
  locked,
  favorited,
  deferImage = false,
  onSelect,
  onFavoriteClick,
}: EmotePickerItemProps) {
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

  const ariaLabel = locked ? `${emote.name} — subscriber-only emote` : emote.name;

  return (
    <div
      className="relative group flex h-10 aspect-square items-center justify-center rounded-[4px] border border-[#515151] bg-transparent p-1 ring-1 ring-inset ring-[#515151] transition-[background-color,border-color,box-shadow] duration-150 ease-in-out hover:bg-white/[0.08] hover:border-[#666666] hover:ring-[#666666]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={emote.name}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        aria-disabled={locked ? "true" : undefined}
        // content-visibility lets the browser skip layout/paint/decode for
        // emotes scrolled off-screen — the main scroll-jank cost when paging
        // through a large set. Applied to the image button (not the outer
        // cell) so the hover "favorite" star, an overflowing sibling, isn't
        // clipped by paint containment. contain-intrinsic-size reserves the
        // row height so skipped rows don't collapse and shift the scroll.
        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 28px" }}
        className={`flex items-center justify-center w-full h-full ${
          locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        <EmoteImage
          emote={emote}
          size="medium"
          showTooltip={false}
          lazyLoad={true}
          deferLoad={deferImage}
          deferredPlaceholder={deferImage ? "static" : "pulse"}
        />
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
            favorited ? "bg-yellow-500 text-black" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          <StarIcon filled={favorited} />
        </button>
      )}
    </div>
  );
});

EmotePickerItem.displayName = "EmotePickerItem";

/* ------------------------------------------------------------------------ */
/* Main dialog                                                              */
/* ------------------------------------------------------------------------ */

export const EmotePickerPopover: React.FC<EmotePickerPopoverProps> = ({
  isOpen,
  onClose,
  onSelect,
  anchorRef,
  scope,
  platform,
  channelId: _channelId,
  viewerIsSubscribed,
  channelAvatarUrl,
  channelLabel,
}) => {
  const providers = useMemo(() => getProvidersForScope(scope, platform), [scope, platform]);
  const subSections = useMemo(
    () => getSubSectionsForScope(scope, platform, channelAvatarUrl),
    [scope, platform, channelAvatarUrl]
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSubSection, setActiveSubSection] = useState<SubSection | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [scrollSnapshot, setScrollSnapshot] = useState({
    top: 0,
    height: DEFAULT_PICKER_VIEWPORT_PX,
  });
  const [isPickerScrolling, setIsPickerScrolling] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { recentEmotes, favoriteEmotes, activeChannelId, loadedChannels, loadedGlobalPlatforms } =
    useEmoteStore(
      useShallow((state) => ({
        recentEmotes: state.recentEmotes,
        favoriteEmotes: state.favoriteEmotes,
        activeChannelId: state.activeChannelId,
        loadedChannels: state.loadedChannels,
        loadedGlobalPlatforms: state.loadedGlobalPlatforms,
      }))
    );
  const addRecentEmote = useEmoteStore((state) => state.addRecentEmote);
  const toggleFavorite = useEmoteStore((state) => state.toggleFavorite);
  const isFavorite = useEmoteStore((state) => state.isFavorite);
  const getEmotesByProvider = useEmoteStore((state) => state.getEmotesByProvider);

  // Provider → emotes map. Recompute when underlying load state shifts.
  // `loadedGlobalPlatforms.size` is a stable primitive across renders (Sets
  // get rebuilt on each per-platform completion), so it tracks the actual
  // signal the memo cares about — globals coming online for any platform.
  // biome-ignore lint/correctness/useExhaustiveDependencies: getEmotesByProvider is a stable zustand selector; including it would not change behavior but would add noise
  const emotesByProvider = useMemo(
    () => getEmotesByProvider(),
    [activeChannelId, loadedChannels, loadedGlobalPlatforms.size]
  );

  /* --------------------------- focus on open --------------------------- */
  // The dialog paints at top/left:-9999 until the positioning layout effect
  // sets `position`. Focus once it is on-screen (position set) — gating on
  // `position` (not a 100ms timer) avoids scrolling the off-screen input into
  // view. `hasFocusedRef` keeps it to one focus per open.
  const hasFocusedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) hasFocusedRef.current = false;
  }, [isOpen]);
  useLayoutEffect(() => {
    if (isOpen && position && !hasFocusedRef.current) {
      hasFocusedRef.current = true;
      searchInputRef.current?.focus();
    }
  }, [isOpen, position]);

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
    // Reposition only when the anchor itself moves (page/ancestor scroll or
    // resize) — never on the picker's own inner scroll. The capture-phase
    // listener sees every scroll in the document, including the dialog body's
    // overflow-y-auto; recomputing position (getBoundingClientRect + setState
    // → full dialog re-render) on each inner-scroll frame was the scroll jank.
    // Passive: this listener never calls preventDefault.
    const onAncestorScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      updatePosition();
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", onAncestorScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onAncestorScroll, true);
    };
  }, [isOpen, anchorRef]);

  /* ----------------------- outside click / Escape ---------------------- */
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
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
  const inScope = useCallback((emote: Emote) => providers.includes(emote.provider), [providers]);

  const matchesSearch = useCallback(
    (emote: Emote) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return emote.name.toLowerCase().includes(q);
    },
    [searchQuery]
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
  const providerSections = useMemo(() => {
    const channelTitle = channelLabel?.trim() || "Channel";
    return providers.flatMap((provider) => {
      const all = (emotesByProvider.get(provider) ?? []).filter((e) => matchesSearch(e));

      if (provider === "kick" && platform === "kick") {
        return [
          {
            id: "channel",
            title: channelTitle,
            emotes: all.filter((e) => getKickEmoteSection(e) === "channel"),
          },
          {
            id: "global",
            title: "Global",
            emotes: all.filter((e) => getKickEmoteSection(e) === "global"),
          },
          {
            id: "emoji",
            title: "Emojis",
            emotes: all.filter((e) => getKickEmoteSection(e) === "emoji"),
          },
        ];
      }

      if (provider === "7tv" && platform === "kick") {
        return [
          { id: "channel", title: channelTitle, emotes: all.filter((e) => !e.isGlobal) },
          { id: "global", title: "Global", emotes: all.filter((e) => e.isGlobal) },
        ];
      }

      if (provider === "twitch" && platform === "twitch") {
        return [
          { id: "channel", title: channelTitle, emotes: all.filter((e) => !e.isGlobal) },
          { id: "global", title: "Global", emotes: all.filter((e) => e.isGlobal) },
        ];
      }

      return [{ id: provider, title: PROVIDER_LABELS[provider], emotes: all }];
    });
  }, [providers, emotesByProvider, matchesSearch, platform, channelLabel]);

  /* ----------------------------- handlers ---------------------------- */
  const handleEmoteClick = useCallback(
    (emote: Emote) => {
      addRecentEmote(emote);
      onSelect(emote);
    },
    [addRecentEmote, onSelect]
  );

  const setSectionRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      sectionRefs.current[id] = node;
    },
    []
  );

  const handleSubSectionClick = useCallback((sub: SubSectionConfig) => {
    setActiveSubSection(sub.id);
    sectionRefs.current[sub.targetSectionId]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollSnapshot({
      top: el.scrollTop,
      height: el.clientHeight || DEFAULT_PICKER_VIEWPORT_PX,
    });
    setIsPickerScrolling(true);
    if (scrollIdleTimerRef.current != null) {
      window.clearTimeout(scrollIdleTimerRef.current);
    }
    // timer-allowlist: scroll idle debounce for deferred emote image loading
    scrollIdleTimerRef.current = window.setTimeout(() => {
      scrollIdleTimerRef.current = null;
      setIsPickerScrolling(false);
    }, SCROLL_IDLE_DEFER_MS);
  }, []);

  useEffect(
    () => () => {
      if (scrollIdleTimerRef.current != null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
    },
    []
  );

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

  // Portal to <body> so position:fixed anchors to the viewport rather than to
  // a transformed ancestor (chat panel uses CSS transforms internally; without
  // the portal the dialog renders 1500+ px past the viewport edge).
  return createPortal(
    <div
      ref={containerRef}
      data-testid="emote-picker-popover"
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

      {/* Sub-section icon row — KickTalk `.dialogHeadMenuItem` spec:
       *    32×32, 4px radius, 1px border #ffffff33, hover bg #ffffff21 /
       *    border #ffffff37, icon opacity 0.5 → 1. The avatar tab keeps full
       *    opacity at rest (it's a photo, not a glyph; dimming it makes the
       *    channel feel "off"). */}
      {subSections.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-[var(--color-border)]">
          {subSections.map((sub) => {
            const active = activeSubSection === sub.id;
            const isAvatar = sub.id === "channel" && !!channelAvatarUrl;
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => handleSubSectionClick(sub)}
                aria-pressed={active}
                aria-label={sub.label}
                title={sub.label}
                className={`group/tab flex items-center justify-center w-8 h-8 rounded-[4px] border transition-[background-color,border-color] duration-200 ease-in-out text-white ${
                  active
                    ? "bg-white/[0.13] border-white/[0.22]"
                    : "bg-transparent border-white/20 hover:bg-white/[0.13] hover:border-white/[0.22]"
                }`}
              >
                <span
                  className={`flex items-center justify-center transition-opacity duration-200 ease-in-out ${
                    isAvatar || active ? "opacity-100" : "opacity-50 group-hover/tab:opacity-100"
                  }`}
                >
                  {sub.icon}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleBodyScroll}>
        <EmoteSection
          sectionId="frequent"
          title="Frequently Used"
          emotes={recentInScope}
          collapsedHeaderOnly={searching}
          showLock={showLock}
          onEmoteClick={handleEmoteClick}
          onFavoriteClick={toggleFavorite}
          isFavorite={isFavorite}
          deferImages={isPickerScrolling}
          scrollTop={scrollSnapshot.top}
          viewportHeight={scrollSnapshot.height}
          sectionRef={setSectionRef("frequent")}
        />
        <EmoteSection
          sectionId="favorites"
          title="Favorites"
          emotes={favoritesInScope}
          collapsedHeaderOnly={searching}
          showLock={showLock}
          onEmoteClick={handleEmoteClick}
          onFavoriteClick={toggleFavorite}
          isFavorite={isFavorite}
          deferImages={isPickerScrolling}
          scrollTop={scrollSnapshot.top}
          viewportHeight={scrollSnapshot.height}
          sectionRef={setSectionRef("favorites")}
        />
        {providerSections.map(({ id, title, emotes }) => (
          <EmoteSection
            key={id}
            sectionId={id}
            title={title}
            emotes={emotes}
            showLock={showLock}
            onEmoteClick={handleEmoteClick}
            onFavoriteClick={toggleFavorite}
            isFavorite={isFavorite}
            deferImages={isPickerScrolling}
            scrollTop={scrollSnapshot.top}
            viewportHeight={scrollSnapshot.height}
            sectionRef={setSectionRef(id)}
          />
        ))}
      </div>
    </div>,
    document.body
  );
};

export default EmotePickerPopover;
