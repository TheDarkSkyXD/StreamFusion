/**
 * EmotePickerPopover Component
 *
 * Reusable anchored popover used by both native and third-party emote buttons.
 * Not a modal dialog — it portals to body and renders at `position: fixed`
 * anchored to an external ref, with no backdrop, no focus trap, and no
 * escape-to-close-modal semantics. The container therefore carries no
 * `role="dialog"`; `aria-label` is retained so screen readers can still
 * identify the picker. Translates KickTalk's emote picker pattern: search
 * bar, sub-section icon row, pinned Recent/Favorites, provider
 * sections with windowed emote grids, and Kick subscriber-only lock overlay.
 */

import type React from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import type { Emote, EmoteProvider } from "../../../../../backend/services/emotes/emote-types";
import { useManagedTimeout } from "../../../../hooks/useManagedTimeout";
import { getEmoteViewerScopeKey, useEmoteStore } from "../../../../store/emote-store";
import { KickIcon } from "../../../../components/icons/PlatformIcons";
import { ProxiedImage } from "../../../../components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { EmoteImage } from "./EmoteImage";

export type EmotePickerScope = "native" | "thirdParty";
export type EmotePickerPlatform = "twitch" | "kick";
const EMPTY_RECENT_EMOTES: Emote[] = [];

interface EmotePickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emote: Emote) => void;
  anchorRef: React.RefObject<HTMLElement>;
  scope: EmotePickerScope;
  platform: EmotePickerPlatform;
  channelId?: string | null;
  channelName?: string | null;
  kickUserId?: string | null;
  viewerUserId?: string;
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
type UserEmoteSubSection = `user:${string}`;
type SubSection =
  | "recent"
  | "channel"
  | "global"
  | "emoji"
  | "7tv"
  | "bttv"
  | "ffz"
  | UserEmoteSubSection;

interface SubSectionConfig {
  id: SubSection;
  label: string;
  icon: React.ReactNode;
  targetSectionId: string;
}

type ProviderSourceTab = "channel" | "global";

interface EmoteSectionTab {
  id: ProviderSourceTab;
  label: string;
  ariaLabel: string;
  active: boolean;
  onClick: () => void;
}

interface EmoteSectionModel {
  id: string;
  title: string;
  emotes: Emote[];
  tabs?: EmoteSectionTab[];
}

interface UserEmoteGroup {
  key: string;
  subSectionId: UserEmoteSubSection;
  sectionId: string;
  title: string;
  avatarUrl?: string;
  emotes: Emote[];
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
  <ProxiedImage
    src={src}
    alt=""
    className="w-6 h-6 rounded-[3px] object-cover"
    width={24}
    height={24}
    fallback={<div className="w-6 h-6 rounded-[3px] bg-white/10" />}
  />
);

const LockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" width={14} height={14}>
    <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z" />
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
  channelAvatarUrl?: string | null,
  showNativeChannelSection = true,
  userEmoteGroups: UserEmoteGroup[] = []
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
      { id: "global", label: "Global", icon: <GlobeIcon />, targetSectionId: "global" },
      ...(showNativeChannelSection
        ? [
            {
              id: "channel" as const,
              label: "Channel",
              icon: channelIcon,
              targetSectionId: "channel",
            },
          ]
        : []),
      ...userEmoteGroups.map((group) => ({
        id: group.subSectionId,
        label: `${group.title}'s Emotes`,
        icon: group.avatarUrl ? (
          <ChannelAvatarIcon src={group.avatarUrl} />
        ) : (
          <StarIcon filled={false} />
        ),
        targetSectionId: group.sectionId,
      })),
    ];
  }
  if (scope === "native" && platform === "kick") {
    return [
      frequent,
      { id: "global", label: "Global", icon: <GlobeIcon />, targetSectionId: "global" },
      ...(showNativeChannelSection
        ? [
            {
              id: "channel" as const,
              label: "Channel",
              icon: channelIcon,
              targetSectionId: "channel",
            },
          ]
        : []),
      ...userEmoteGroups.map((group) => ({
        id: group.subSectionId,
        label: `${group.title}'s Emotes`,
        icon: group.avatarUrl ? (
          <ChannelAvatarIcon src={group.avatarUrl} />
        ) : (
          <StarIcon filled={false} />
        ),
        targetSectionId: group.sectionId,
      })),
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
    {
      id: "7tv",
      label: "7TV",
      icon: <span className="font-bold text-xs">7TV</span>,
      targetSectionId: "7tv",
    },
  ];
}

const PROVIDER_LABELS: Record<EmoteProvider, string> = {
  twitch: "Twitch",
  kick: "Kick",
  "7tv": "7TV",
  bttv: "BetterTTV",
  ffz: "FrankerFaceZ",
};

function getKickEmoteSection(emote: Emote): "channel" | "subscribed" | "global" | "emoji" {
  if (emote.kickSection) return emote.kickSection;
  return emote.isGlobal ? "global" : "channel";
}

function makeSectionIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-") || "unknown";
}

function getUserEmoteGroupKey(emote: Emote): string {
  return emote.owner?.id || emote.owner?.username || emote.channelId || emote.id;
}

function getUserEmoteGroupTitle(emote: Emote): string {
  return (
    emote.owner?.displayName?.trim() ||
    emote.owner?.username?.trim() ||
    emote.channelId?.trim() ||
    "Subscribed"
  );
}

function hasProviderGlobalOrUserEmotes(provider: EmoteProvider, emotes: Emote[]): boolean {
  if (provider === "kick") {
    return emotes.some((emote) => {
      const section = getKickEmoteSection(emote);
      return section !== "channel" || emote.availability === "user";
    });
  }
  if (provider === "twitch") {
    return emotes.some((emote) => emote.isGlobal || emote.availability === "user");
  }
  return emotes.some((emote) => emote.isGlobal);
}

const ITEM_SIZE_PX = 40;
const ITEM_GAP_PX = 8;
const ITEM_PITCH_PX = ITEM_SIZE_PX + ITEM_GAP_PX;
const DEFAULT_GRID_WIDTH_PX = 336;
const DEFAULT_PICKER_VIEWPORT_PX = 360;
const OVERSCAN_ROWS = 3;
const WINDOW_PRELOAD_PX = DEFAULT_PICKER_VIEWPORT_PX;
const SCROLL_ACTIVE_VIEWPORT_RATIO = 0.35;
const SCROLL_ACTIVE_MAX_OFFSET_PX = 160;
const TWITCH_USER_EMOTE_SCOPE = "user:read:emotes";
type TwitchUserEmoteScopeStatus = "granted" | "missing" | "unknown";

function hasTwitchUserEmoteScope(scopes?: string[]): boolean {
  return (scopes ?? []).includes(TWITCH_USER_EMOTE_SCOPE);
}

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
  const preloadTop = relativeTop - WINDOW_PRELOAD_PX;
  const preloadBottom = relativeBottom + WINDOW_PRELOAD_PX;

  let startRow = 0;
  let endRow = totalRows;

  if (preloadBottom < 0) {
    startRow = 0;
    endRow = 0;
  } else if (preloadTop > totalHeight) {
    startRow = totalRows;
    endRow = totalRows;
  } else {
    startRow = Math.max(0, Math.floor(Math.max(0, preloadTop) / ITEM_PITCH_PX));
    endRow = Math.min(totalRows, Math.ceil(Math.max(0, preloadBottom) / ITEM_PITCH_PX));
  }

  return {
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRow * columns),
    topSpacer: startRow * ITEM_PITCH_PX,
    bottomSpacer: Math.max(0, (totalRows - endRow) * ITEM_PITCH_PX),
  };
}

function getActiveSubSectionForScroll(
  subSections: SubSectionConfig[],
  sectionRefs: Record<string, HTMLDivElement | null>,
  scrollTop: number,
  scrollRootOffsetTop: number,
  viewportHeight: number
): SubSection | null {
  const activationOffset = Math.min(
    viewportHeight * SCROLL_ACTIVE_VIEWPORT_RATIO,
    SCROLL_ACTIVE_MAX_OFFSET_PX
  );
  const activationLine = scrollTop + activationOffset;
  let activeSubSection: SubSection | null = null;

  for (const subSection of subSections) {
    const section = sectionRefs[subSection.targetSectionId];
    if (!section) continue;
    if (section.offsetTop - scrollRootOffsetTop > activationLine) break;
    activeSubSection = subSection.id;
  }

  return activeSubSection;
}

/* ------------------------------------------------------------------------ */
/* Section                                                                  */
/* ------------------------------------------------------------------------ */

interface EmoteSectionProps {
  sectionId: string;
  title: string;
  emotes: Emote[];
  tabs?: EmoteSectionTab[];
  collapsedHeaderOnly?: boolean;
  showCollapsedCount?: boolean;
  showLock: (emote: Emote) => boolean;
  onEmoteClick: (emote: Emote) => void;
  onLockedEmoteClick: (emote: Emote) => void;
  onFavoriteClick: (emote: Emote) => void;
  isFavorite: (emoteId: string) => boolean;
  scrollTop?: number;
  viewportHeight?: number;
  sectionRef?: (node: HTMLDivElement | null) => void;
}

const EmoteSection: React.FC<EmoteSectionProps> = ({
  sectionId,
  title,
  emotes,
  tabs,
  collapsedHeaderOnly = false,
  showCollapsedCount = true,
  showLock,
  onEmoteClick,
  onLockedEmoteClick,
  onFavoriteClick,
  isFavorite,
  scrollTop = 0,
  viewportHeight = DEFAULT_PICKER_VIEWPORT_PX,
  sectionRef,
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const columns = getColumnCount(DEFAULT_GRID_WIDTH_PX);
  const windowRange = useMemo(
    () =>
      getVisibleWindow({
        itemCount: emotes.length,
        columns,
        scrollTop,
        viewportHeight,
        gridOffsetTop: bodyRef.current?.offsetTop ?? 0,
      }),
    [emotes.length, columns, scrollTop, viewportHeight]
  );
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
      <div className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
        <span className="text-[#777777]">
          {title}
          {collapsedHeaderOnly && showCollapsedCount && (
            <span className="ml-2 normal-case font-normal text-[#777777]">
              ({emotes.length} match{emotes.length === 1 ? "" : "es"})
            </span>
          )}
        </span>
      </div>
      {!collapsedHeaderOnly && (
        <div ref={bodyRef} className="p-3">
          {tabs && tabs.length > 0 && (
            <div
              data-testid={`${sectionId}-source-tabs`}
              className="mb-3 flex w-full items-center gap-1 rounded-[4px] bg-[var(--color-background-tertiary)] p-1"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-label={tab.ariaLabel}
                  aria-pressed={tab.active}
                  onClick={tab.onClick}
                  className={`h-7 flex-1 rounded-[3px] px-2 text-xs font-semibold transition-colors ${
                    tab.active
                      ? "bg-[var(--color-background-secondary)] text-white"
                      : "text-[var(--color-foreground-muted)] hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
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
                    onSelect={onEmoteClick}
                    onLockedSelect={onLockedEmoteClick}
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
  onSelect: (emote: Emote) => void;
  onLockedSelect: (emote: Emote) => void;
  onFavoriteClick: (emote: Emote) => void;
}

const EmotePickerItem = memo(function EmotePickerItem({
  emote,
  locked,
  favorited,
  onSelect,
  onLockedSelect,
  onFavoriteClick,
}: EmotePickerItemProps) {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(() => {
    if (locked) {
      onLockedSelect(emote);
      return;
    }
    onSelect(emote);
  }, [locked, onLockedSelect, onSelect, emote]);

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
    >
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
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
            <EmoteImage emote={emote} size="medium" showTooltip={false} lazyLoad={true} />
            {locked && (
              <span
                data-testid="emote-lock-overlay"
                className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-[3px] bg-black/75 text-white shadow-sm ring-1 ring-white/20 pointer-events-none"
              >
                <LockIcon />
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{emote.name}</TooltipContent>
      </Tooltip>
      {hovered && !locked && (
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={favorited ? `Unfavorite ${emote.name}` : `Favorite ${emote.name}`}
          className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${
            favorited
              ? "bg-yellow-500 text-black"
              : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
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
  channelId,
  channelName,
  kickUserId,
  viewerUserId,
  viewerIsSubscribed,
  channelAvatarUrl,
  channelLabel,
}) => {
  const providers = useMemo(() => getProvidersForScope(scope, platform), [scope, platform]);

  const [searchQuery, setSearchQuery] = useState("");
  const [requestedSubSection, setRequestedSubSection] = useState<SubSection>("recent");
  const [scrollActiveSubSection, setScrollActiveSubSection] = useState<SubSection | null>(null);
  const [providerSourceTabs, setProviderSourceTabs] = useState<
    Partial<Record<EmoteProvider, ProviderSourceTab>>
  >({});
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [scrollSnapshot, setScrollSnapshot] = useState({
    top: 0,
    height: DEFAULT_PICKER_VIEWPORT_PX,
  });
  const [missingTwitchUserEmoteScope, setMissingTwitchUserEmoteScope] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const programmaticScrollTargetRef = useRef<SubSection | null>(null);
  const programmaticScrollReleaseTimer = useManagedTimeout(
    useCallback(() => {
      programmaticScrollTargetRef.current = null;
    }, [])
  );

  const viewerScopeKey = getEmoteViewerScopeKey({
    platform,
    userId: viewerUserId ?? null,
  });
  const {
    recentEmotes,
    favoriteEmotes,
    activeChannelId,
    loadedChannels,
    loadedGlobalPlatforms,
    emoteRevision,
  } = useEmoteStore(
    useShallow((state) => ({
      recentEmotes: state.recentEmotesByScope[viewerScopeKey] ?? EMPTY_RECENT_EMOTES,
      favoriteEmotes: state.favoriteEmotes,
      activeChannelId: state.activeChannelId,
      loadedChannels: state.loadedChannels,
      loadedGlobalPlatforms: state.loadedGlobalPlatforms,
      emoteRevision: state.emoteRevision,
    }))
  );
  const toggleFavorite = useEmoteStore((state) => state.toggleFavorite);
  const isFavorite = useEmoteStore((state) => state.isFavorite);
  const getEmotesByProvider = useEmoteStore((state) => state.getEmotesByProvider);
  const loadGlobalEmotes = useEmoteStore((state) => state.loadGlobalEmotes);
  const loadChannelEmotes = useEmoteStore((state) => state.loadChannelEmotes);
  const openLoadAttemptRef = useRef<string | null>(null);
  const openChannelLoadAttemptRef = useRef<string | null>(null);

  // Provider → emotes map. Recompute when manager-backed emote data changes.
  // `emoteRevision` covers force reloads whose Set sizes don't change (for
  // example: a failed empty global load followed by a successful retry).
  // biome-ignore lint/correctness/useExhaustiveDependencies: getEmotesByProvider is a stable zustand selector; including it would not change behavior but would add noise
  const emotesByProvider = useMemo(
    () => getEmotesByProvider(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revisions intentionally invalidate a stable Zustand getter result.
    [activeChannelId, getEmotesByProvider, loadedChannels, loadedGlobalPlatforms.size, emoteRevision]
  );

  const refreshTwitchUserEmoteScopeStatus =
    useCallback(async (): Promise<TwitchUserEmoteScopeStatus> => {
      const tokenStatus = window.electronAPI?.auth?.tokenStatus;
      if (!tokenStatus) {
        setMissingTwitchUserEmoteScope(false);
        return "unknown";
      }

      try {
        const status = await tokenStatus("twitch");
        const hasScope =
          status?.connected === true &&
          status.valid === true &&
          hasTwitchUserEmoteScope(status.scopes);
        const isMissing = status?.connected === true && status.valid === true && !hasScope;
        setMissingTwitchUserEmoteScope(isMissing);
        if (hasScope) return "granted";
        return isMissing ? "missing" : "unknown";
      } catch {
        setMissingTwitchUserEmoteScope(false);
        return "unknown";
      }
    }, []);

  useEffect(() => {
    if (!isOpen) {
      openLoadAttemptRef.current = null;
      openChannelLoadAttemptRef.current = null;
      return;
    }

    const attemptKey = `${scope}:${platform}`;
    if (openLoadAttemptRef.current === attemptKey) return;

    const hasGlobalOrUserEmotes = providers.some((provider) =>
      hasProviderGlobalOrUserEmotes(provider, emotesByProvider.get(provider) ?? [])
    );
    if (hasGlobalOrUserEmotes) return;

    openLoadAttemptRef.current = attemptKey;

    if (scope === "native" && platform === "twitch") {
      void refreshTwitchUserEmoteScopeStatus().then((status) => {
        if (openLoadAttemptRef.current !== attemptKey) return;
        if (status === "missing") return;
        void loadGlobalEmotes(platform, { force: true });
      });
      return;
    }

    void loadGlobalEmotes(platform, { force: true });
  }, [
    isOpen,
    scope,
    platform,
    providers,
    emotesByProvider,
    loadGlobalEmotes,
    refreshTwitchUserEmoteScopeStatus,
  ]);

  useEffect(() => {
    if (!isOpen || !channelId) return;

    const attemptKey = `${scope}:${platform}:${channelId}`;
    if (openChannelLoadAttemptRef.current === attemptKey) return;

    const hasScopedChannelEmotes = providers.some((provider) => {
      const emotes = emotesByProvider.get(provider) ?? [];
      if (provider === "kick") {
        return emotes.some((emote) => getKickEmoteSection(emote) === "channel");
      }
      if (provider === "twitch") {
        return emotes.some((emote) => !emote.isGlobal && emote.availability !== "user");
      }
      return emotes.some((emote) => !emote.isGlobal);
    });
    if (hasScopedChannelEmotes) return;

    openChannelLoadAttemptRef.current = attemptKey;
    void loadChannelEmotes(
      channelId,
      channelName ?? channelLabel ?? undefined,
      platform,
      kickUserId ?? undefined,
      { force: true }
    );
  }, [
    isOpen,
    scope,
    platform,
    providers,
    emotesByProvider,
    channelId,
    channelName,
    channelLabel,
    kickUserId,
    loadChannelEmotes,
  ]);

  const showNativeChannelSection = useMemo(() => {
    if (scope !== "native") return true;
    const nativeProvider = platform === "twitch" ? "twitch" : "kick";
    const nativeEmotes = emotesByProvider.get(nativeProvider) ?? [];
    if (platform === "kick") {
      return nativeEmotes.some((emote) => getKickEmoteSection(emote) === "channel");
    }
    return nativeEmotes.some((emote) => !emote.isGlobal && emote.availability !== "user");
  }, [scope, platform, emotesByProvider]);

  const nativeUserEmoteGroups = useMemo<UserEmoteGroup[]>(() => {
    if (scope !== "native") return [];
    const nativeProvider = platform === "twitch" ? "twitch" : "kick";
    const nativeEmotes = emotesByProvider.get(nativeProvider) ?? [];
    const groups = new Map<string, UserEmoteGroup>();

    for (const emote of nativeEmotes) {
      if (emote.availability !== "user") continue;
      const key = `${nativeProvider}:${getUserEmoteGroupKey(emote)}`;
      const existing = groups.get(key);
      if (existing) {
        existing.emotes.push(emote);
        continue;
      }

      const sectionKey = makeSectionIdPart(key);
      groups.set(key, {
        key,
        subSectionId: `user:${sectionKey}`,
        sectionId: `subscribed-${sectionKey}`,
        title: getUserEmoteGroupTitle(emote),
        avatarUrl: emote.owner?.avatarUrl,
        emotes: [emote],
      });
    }

    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [scope, platform, emotesByProvider]);

  const subSections = useMemo(
    () =>
      getSubSectionsForScope(
        scope,
        platform,
        channelAvatarUrl,
        showNativeChannelSection,
        nativeUserEmoteGroups
      ),
    [scope, platform, channelAvatarUrl, showNativeChannelSection, nativeUserEmoteGroups]
  );

  useEffect(() => {
    if (isOpen && scope === "native" && platform === "twitch") {
      void refreshTwitchUserEmoteScopeStatus().then(() => {});
    }
  }, [isOpen, scope, platform, refreshTwitchUserEmoteScopeStatus]);

  const clearProgrammaticScrollTarget = useCallback(() => {
    programmaticScrollTargetRef.current = null;
    programmaticScrollReleaseTimer.clear();
  }, [programmaticScrollReleaseTimer]);

  useEffect(() => {
    if (!isOpen) {
      clearProgrammaticScrollTarget();
    }
    return clearProgrammaticScrollTarget;
  }, [isOpen, clearProgrammaticScrollTarget]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const scrollRoot = scrollRef.current;
    if (scrollRoot) {
      scrollRoot.scrollTop = 0;
    }
    setScrollSnapshot({
      top: 0,
      height: scrollRoot?.clientHeight || DEFAULT_PICKER_VIEWPORT_PX,
    });
  }, [isOpen]);

  useEffect(() => {
    const pendingTarget = programmaticScrollTargetRef.current;
    if (pendingTarget && !subSections.some((sub) => sub.id === pendingTarget)) {
      clearProgrammaticScrollTarget();
    }
  }, [subSections, clearProgrammaticScrollTarget]);

  const activeSubSection = useMemo(() => {
    if (subSections.some((sub) => sub.id === scrollActiveSubSection)) {
      return scrollActiveSubSection;
    }
    if (subSections.some((sub) => sub.id === requestedSubSection)) {
      return requestedSubSection;
    }
    return subSections[0]?.id ?? "recent";
  }, [subSections, requestedSubSection, scrollActiveSubSection]);

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

  const handleProviderSourceTabClick = useCallback(
    (provider: EmoteProvider, tab: ProviderSourceTab) => {
      setProviderSourceTabs((current) => ({ ...current, [provider]: tab }));
    },
    []
  );

  /* ----------------------- per-provider lists ---------------------- */
  const providerSections = useMemo<EmoteSectionModel[]>(() => {
    const channelTitle = channelLabel?.trim() || "Channel";
    return providers.flatMap((provider) => {
      const raw = emotesByProvider.get(provider) ?? [];
      const all = raw.filter((e) => matchesSearch(e));

      if (provider === "kick" && platform === "kick") {
        const channelEmotes = all.filter((e) => getKickEmoteSection(e) === "channel");
        return [
          {
            id: "global",
            title: "Global",
            emotes: all.filter((e) => getKickEmoteSection(e) === "global"),
          },
          ...(showNativeChannelSection
            ? [{ id: "channel", title: channelTitle, emotes: channelEmotes }]
            : []),
          ...nativeUserEmoteGroups.map((group) => ({
            id: group.sectionId,
            title: group.title,
            emotes: group.emotes.filter((emote) => matchesSearch(emote)),
          })),
          {
            id: "emoji",
            title: "Emojis",
            emotes: all.filter((e) => getKickEmoteSection(e) === "emoji"),
          },
        ];
      }

      if (scope === "thirdParty" && ["7tv", "bttv", "ffz"].includes(provider)) {
        const providerTitle = PROVIDER_LABELS[provider];
        const hasChannelEmotes = raw.some((e) => !e.isGlobal);
        const sourceTabs = [
          ...(hasChannelEmotes
            ? [
                {
                  id: "channel" as const,
                  label: "Channel",
                  emotes: all.filter((e) => !e.isGlobal),
                },
              ]
            : []),
          {
            id: "global" as const,
            label: "Global",
            emotes: all.filter((e) => e.isGlobal),
          },
        ];
        const requestedTab = providerSourceTabs[provider];
        const activeTabId = sourceTabs.some((tab) => tab.id === requestedTab)
          ? requestedTab
          : sourceTabs[0]?.id;
        const activeTab = sourceTabs.find((tab) => tab.id === activeTabId) ?? sourceTabs[0];

        return [
          {
            id: provider,
            title: providerTitle,
            emotes: activeTab?.emotes ?? [],
            tabs: sourceTabs.map((tab) => ({
              id: tab.id,
              label: tab.label,
              ariaLabel: `${providerTitle} ${tab.label}`,
              active: tab.id === activeTabId,
              onClick: () => handleProviderSourceTabClick(provider, tab.id),
            })),
          },
        ];
      }

      if (provider === "twitch" && platform === "twitch") {
        const channelEmotes = all.filter((e) => !e.isGlobal && e.availability !== "user");
        return [
          {
            id: "global",
            title: "Global",
            emotes: all.filter((e) => e.isGlobal && e.availability !== "user"),
          },
          ...(showNativeChannelSection
            ? [{ id: "channel", title: channelTitle, emotes: channelEmotes }]
            : []),
          ...nativeUserEmoteGroups.map((group) => ({
            id: group.sectionId,
            title: group.title,
            emotes: group.emotes.filter((emote) => matchesSearch(emote)),
          })),
        ];
      }

      return [{ id: provider, title: PROVIDER_LABELS[provider], emotes: all }];
    });
  }, [
    providers,
    emotesByProvider,
    matchesSearch,
    scope,
    platform,
    channelLabel,
    showNativeChannelSection,
    nativeUserEmoteGroups,
    providerSourceTabs,
    handleProviderSourceTabClick,
  ]);

  /* ----------------------------- handlers ---------------------------- */
  const handleEmoteClick = useCallback(
    (emote: Emote) => {
      onSelect(emote);
    },
    [onSelect]
  );

  const handleLockedEmoteClick = useCallback((emote: Emote) => {
    toast.warning("You must subscribe to this channel to use this emote.", {
      description: emote.name,
    });
  }, []);

  const handleReconnectTwitch = useCallback(() => {
    void window.electronAPI.auth
      .logoutTwitch()
      .then((logoutResult) => {
        if (!logoutResult.success) {
          throw new Error(logoutResult.error || "Could not clear the old Twitch grant.");
        }
        return window.electronAPI.auth.openTwitchLogin();
      })
      .then(async () => {
        const scopeStatus = await refreshTwitchUserEmoteScopeStatus();
        if (scopeStatus !== "granted") {
          toast.warning("Twitch did not grant subscribed-channel emote access.", {
            description: `Authorize the ${TWITCH_USER_EMOTE_SCOPE} scope to load those emotes.`,
          });
          return;
        }
        openLoadAttemptRef.current = null;
        void loadGlobalEmotes("twitch", { force: true });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Try again from Settings.";
        toast.warning("Could not reconnect Twitch.", { description: message });
      });
  }, [loadGlobalEmotes, refreshTwitchUserEmoteScopeStatus]);

  const setSectionRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      sectionRefs.current[id] = node;
    },
    []
  );

  const handleSubSectionClick = useCallback(
    (sub: SubSectionConfig) => {
      programmaticScrollTargetRef.current = sub.id;
      programmaticScrollReleaseTimer.start(700);
      setRequestedSubSection(sub.id);
      setScrollActiveSubSection(sub.id);
      sectionRefs.current[sub.targetSectionId]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    },
    [programmaticScrollReleaseTimer]
  );

  const handleBodyScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setScrollSnapshot({
        top: el.scrollTop,
        height: el.clientHeight || DEFAULT_PICKER_VIEWPORT_PX,
      });
      const nextActiveSubSection = getActiveSubSectionForScroll(
        subSections,
        sectionRefs.current,
        el.scrollTop,
        el.offsetTop,
        el.clientHeight || DEFAULT_PICKER_VIEWPORT_PX
      );
      if (nextActiveSubSection) {
        const pendingTarget = programmaticScrollTargetRef.current;
        if (pendingTarget && nextActiveSubSection !== pendingTarget) return;
        if (pendingTarget === nextActiveSubSection) {
          clearProgrammaticScrollTarget();
        }
        setScrollActiveSubSection(nextActiveSubSection);
      }
    },
    [subSections, clearProgrammaticScrollTarget]
  );

  /* --------------------------- lock predicate --------------------------- */
  const showLock = useCallback(
    (emote: Emote): boolean => {
      if (scope !== "native") return false;
      if (!(platform === "kick" || platform === "twitch")) return false;
      if (emote.availability === "user") return false;
      if (viewerIsSubscribed === true) return false;
      return emote.subscribersOnly === true;
    },
    [scope, platform, viewerIsSubscribed]
  );

  if (!isOpen) return null;

  const searching = searchQuery.trim().length > 0;
  const collapseEmptyPinnedSections = !searching;
  const showTwitchUserEmoteScopeNotice =
    scope === "native" &&
    platform === "twitch" &&
    missingTwitchUserEmoteScope &&
    nativeUserEmoteGroups.length === 0;

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

      {/* Sub-section icon row — Kick uses 40px tabs with a 2px rail at
       * bottom-1.5: inactive rail rgba(240,241,242,.16), active rail white. */}
      {subSections.length > 0 && (
        <div className="px-2 py-2 border-b border-[var(--color-border)]">
          <div className="relative w-full max-w-full overflow-x-auto pr-3 pb-1.5">
            <span
              aria-hidden="true"
              data-testid="emote-subsection-rail"
              className="pointer-events-none absolute bottom-0 left-0 right-3 z-0 h-0.5 bg-[rgba(240,241,242,0.16)]"
            />
            <div className="relative z-10 flex items-center gap-2">
              {subSections.map((sub) => {
                const active = activeSubSection === sub.id;
                const isAvatar =
                  (sub.id === "channel" && !!channelAvatarUrl) || sub.id.startsWith("user:");
                return (
                  <Tooltip key={sub.id} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleSubSectionClick(sub)}
                        aria-pressed={active}
                        aria-label={sub.label}
                        className={`group/tab relative flex h-10 w-10 shrink-0 grow-0 items-center justify-center rounded-[4px] border transition-[background-color,border-color] duration-200 ease-in-out text-white ${
                          active
                            ? "bg-white/[0.13] border-white/[0.22]"
                            : "bg-transparent border-white/20 hover:bg-white/[0.13] hover:border-white/[0.22]"
                        }`}
                      >
                        <span
                          className={`flex items-center justify-center transition-opacity duration-200 ease-in-out ${
                            isAvatar || active
                              ? "opacity-100"
                              : "opacity-50 group-hover/tab:opacity-100"
                          }`}
                        >
                          {sub.icon}
                        </span>
                        {active && (
                          <span
                            aria-hidden="true"
                            data-testid="emote-subsection-active-indicator"
                            className="absolute -bottom-1.5 left-0 z-20 h-0.5 w-full bg-white"
                          />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{sub.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showTwitchUserEmoteScopeNotice && (
        <div
          data-testid="twitch-user-emote-scope-notice"
          className="border-b border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-xs leading-4 text-[var(--color-foreground-secondary)]">
              Reconnect Twitch to show subscribed-channel emotes.
            </p>
            <button
              type="button"
              onClick={handleReconnectTwitch}
              className="h-7 shrink-0 rounded-[4px] bg-white px-2 text-xs font-semibold text-[#0f0f0f] transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[var(--color-background-tertiary)]"
            >
              Reconnect
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleBodyScroll}>
        <EmoteSection
          sectionId="frequent"
          title="Frequently Used"
          emotes={recentInScope}
          collapsedHeaderOnly={
            searching || (collapseEmptyPinnedSections && recentInScope.length === 0)
          }
          showCollapsedCount={searching}
          showLock={showLock}
          onEmoteClick={handleEmoteClick}
          onLockedEmoteClick={handleLockedEmoteClick}
          onFavoriteClick={toggleFavorite}
          isFavorite={isFavorite}
          scrollTop={scrollSnapshot.top}
          viewportHeight={scrollSnapshot.height}
          sectionRef={setSectionRef("frequent")}
        />
        <EmoteSection
          sectionId="favorites"
          title="Favorites"
          emotes={favoritesInScope}
          collapsedHeaderOnly={
            searching || (collapseEmptyPinnedSections && favoritesInScope.length === 0)
          }
          showCollapsedCount={searching}
          showLock={showLock}
          onEmoteClick={handleEmoteClick}
          onLockedEmoteClick={handleLockedEmoteClick}
          onFavoriteClick={toggleFavorite}
          isFavorite={isFavorite}
          scrollTop={scrollSnapshot.top}
          viewportHeight={scrollSnapshot.height}
          sectionRef={setSectionRef("favorites")}
        />
        {providerSections.map(({ id, title, emotes, tabs }) => (
          <EmoteSection
            key={id}
            sectionId={id}
            title={title}
            emotes={emotes}
            tabs={tabs}
            showLock={showLock}
            onEmoteClick={handleEmoteClick}
            onLockedEmoteClick={handleLockedEmoteClick}
            onFavoriteClick={toggleFavorite}
            isFavorite={isFavorite}
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
