import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BsChevronDown, BsPeople, BsSearch, BsShieldFill, BsX } from "react-icons/bs";

import type { ChatKnownUser, ChatKnownUserRole } from "../../../../../shared/chat-types";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../../../../shared/auth-types";
import { resolveChatUsernameColor } from "../../utils/chat-visuals";
import { useAuthStore } from "../../../../store/auth-store";
import { useChatStore } from "../../../../store/chat-store";
import { ProxiedImage } from "../../../../components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { ChatBadge as ProviderBadge } from "./ChatBadge";

const EMPTY_CHATTERS: Record<string, ChatKnownUser> = {};
const ACTIVE_CHATTER_AVATAR_BATCH_SIZE = 25;
const ACTIVE_CHATTER_AVATAR_PASSIVE_LIMIT = 75;
const ACTIVE_CHATTER_AVATAR_VISIBLE_ROWS = 6;
const ACTIVE_CHATTER_AVATAR_OVERSCAN_ROWS = 6;
const ACTIVE_CHATTER_ROW_HEIGHT_PX = 32;

type ActiveChatterGroupId = "moderators" | "chatters";
type ActiveChatterGroups = Record<ActiveChatterGroupId, ChatKnownUser[]>;
type ActiveChatterVisibleStarts = Record<ActiveChatterGroupId, number>;

const INITIAL_ACTIVE_CHATTER_VISIBLE_STARTS: ActiveChatterVisibleStarts = {
  moderators: 0,
  chatters: 0,
};

interface AvatarHydrationChannelState {
  requested: Set<string>;
  inFlight: boolean;
  rerunAfterSettle: boolean;
}

interface ActiveChatterSection {
  id: ActiveChatterGroupId;
  label: string;
}

const ACTIVE_CHATTER_SECTIONS: readonly ActiveChatterSection[] = [
  { id: "moderators", label: "Moderators" },
  { id: "chatters", label: "Chatters" },
];

function groupIdForRole(role: ChatKnownUserRole): ActiveChatterGroupId {
  return role === "broadcaster" || role === "moderator" ? "moderators" : "chatters";
}

function matchesActiveChatterSearch(chatter: ChatKnownUser, searchQuery: string): boolean {
  if (searchQuery === "") return true;
  return (
    chatter.username.toLowerCase().includes(searchQuery) ||
    (chatter.displayName || "").toLowerCase().includes(searchQuery)
  );
}

function groupActiveChatters(
  chatters: Readonly<Record<string, ChatKnownUser>>,
  rawSearchQuery: string
): ActiveChatterGroups {
  const searchQuery = rawSearchQuery.trim().toLowerCase();
  const groups: ActiveChatterGroups = {
    moderators: [],
    chatters: [],
  };

  for (const chatter of Object.values(chatters)) {
    if (!matchesActiveChatterSearch(chatter, searchQuery)) continue;
    groups[groupIdForRole(chatter.role ?? "viewer")].push(chatter);
  }
  for (const group of Object.values(groups)) {
    group.sort((left, right) => right.lastSeen.getTime() - left.lastSeen.getTime());
  }
  return groups;
}

function getChannelFromChannelKey(channelKey: string): string | undefined {
  const separatorIndex = channelKey.indexOf(":");
  if (separatorIndex === -1) return undefined;
  return channelKey.slice(separatorIndex + 1) || undefined;
}

function getChatterInitial(user: ChatKnownUser): string {
  const label = (user.displayName || user.username).trim();
  return label.charAt(0).toUpperCase() || "?";
}

interface RecentChattersButtonProps {
  panelId: string;
  open: boolean;
  onClick: () => void;
}

export function RecentChattersButton({ panelId, open, onClick }: RecentChattersButtonProps) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={open ? "Hide active chatters" : "Show active chatters"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onClick}
          className="inline-flex size-8 items-center justify-center rounded-md text-neutral-400 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#9146ff)]"
        >
          {open ? (
            <BsX className="size-5" aria-hidden="true" />
          ) : (
            <BsPeople className="size-4" aria-hidden="true" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Active Chatters</TooltipContent>
    </Tooltip>
  );
}

interface RecentChattersPanelProps {
  id: string;
  channelKey: string;
  onClose: () => void;
}

export function RecentChattersPanel({ id, channelKey, onClose }: RecentChattersPanelProps) {
  const chatters = useChatStore((state) => state.usersByChannel[channelKey] ?? EMPTY_CHATTERS);
  const trackedTotal = useChatStore((state) => state.chatterCountByChannel[channelKey]);
  const updateKnownUserProfiles = useChatStore((state) => state.updateKnownUserProfiles);
  const chatDisplay =
    useAuthStore((state) => state.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<ActiveChatterGroupId>>(
    () => new Set()
  );
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const groupScrollRefs = useRef<Partial<Record<ActiveChatterGroupId, HTMLUListElement | null>>>(
    {}
  );
  const savedGroupScrollRef = useRef<
    Partial<Record<ActiveChatterGroupId, { channelKey: string; top: number }>>
  >({});
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const avatarHydrationByChannelRef = useRef<Record<string, AvatarHydrationChannelState>>({});
  const visibleStartsByChannelRef = useRef<Record<string, ActiveChatterVisibleStarts>>({});
  const mountedRef = useRef(true);
  const [avatarHydrationRevision, setAvatarHydrationRevision] = useState(0);
  const platform = channelKey.startsWith("twitch:") ? "twitch" : "kick";
  const trimmedSearchQuery = searchQuery.trim();

  const groupedChatters = useMemo(() => {
    return groupActiveChatters(chatters, searchQuery);
  }, [chatters, searchQuery]);
  const moderatorBadge = useMemo(() => {
    for (const chatter of Object.values(chatters)) {
      if (groupIdForRole(chatter.role ?? "viewer") !== "moderators") continue;
      const badge = (chatter.badges ?? []).find(
        (candidate) => candidate.setId.toLowerCase() === "moderator"
      );
      if (badge) return badge;
    }
    return undefined;
  }, [chatters]);

  useEffect(() => {
    const api = globalThis.window?.electronAPI?.chat;
    if (!api?.enrichMentionUsers) return;

    const hydration =
      avatarHydrationByChannelRef.current[channelKey] ??
      (avatarHydrationByChannelRef.current[channelKey] = {
        requested: new Set<string>(),
        inFlight: false,
        rerunAfterSettle: false,
      });
    if (hydration.inFlight) {
      hydration.rerunAfterSettle = true;
      return;
    }
    const remainingBudget = trimmedSearchQuery
      ? ACTIVE_CHATTER_AVATAR_BATCH_SIZE
      : ACTIVE_CHATTER_AVATAR_PASSIVE_LIMIT - hydration.requested.size;
    if (remainingBudget <= 0) return;

    const usersToHydrate: Array<{ userId: string; username: string }> = [];
    const groupVisibleStarts =
      visibleStartsByChannelRef.current[channelKey] ?? INITIAL_ACTIVE_CHATTER_VISIBLE_STARTS;
    for (const { id: groupId } of ACTIVE_CHATTER_SECTIONS) {
      if (collapsedGroups.has(groupId)) continue;
      const firstVisibleIndex = groupVisibleStarts[groupId];
      const lastVisibleIndex =
        firstVisibleIndex +
        ACTIVE_CHATTER_AVATAR_VISIBLE_ROWS +
        ACTIVE_CHATTER_AVATAR_OVERSCAN_ROWS;
      for (const user of groupedChatters[groupId].slice(firstVisibleIndex, lastVisibleIndex)) {
        const key = user.username.toLowerCase();
        if (user.avatarUrl || hydration.requested.has(key)) continue;
        usersToHydrate.push({ userId: user.userId, username: user.username });
        if (
          usersToHydrate.length >= ACTIVE_CHATTER_AVATAR_BATCH_SIZE ||
          usersToHydrate.length >= remainingBudget
        ) {
          break;
        }
      }
      if (
        usersToHydrate.length >= ACTIVE_CHATTER_AVATAR_BATCH_SIZE ||
        usersToHydrate.length >= remainingBudget
      ) {
        break;
      }
    }
    if (usersToHydrate.length === 0) return;

    for (const user of usersToHydrate) {
      hydration.requested.add(user.username.toLowerCase());
    }

    hydration.inFlight = true;
    void api
      .enrichMentionUsers({
        platform,
        channel: getChannelFromChannelKey(channelKey),
        users: usersToHydrate,
      })
      .then((result) => {
        if (!mountedRef.current || !result.success || !result.data) return;
        updateKnownUserProfiles(channelKey, result.data);
      })
      .finally(() => {
        hydration.inFlight = false;
        if (!hydration.rerunAfterSettle || !mountedRef.current) return;
        hydration.rerunAfterSettle = false;
        setAvatarHydrationRevision((revision) => revision + 1);
      });
  }, [
    avatarHydrationRevision,
    channelKey,
    collapsedGroups,
    groupedChatters,
    platform,
    trimmedSearchQuery,
    updateKnownUserProfiles,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useLayoutEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => returnFocusRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    for (const { id: groupId } of ACTIVE_CHATTER_SECTIONS) {
      const saved = savedGroupScrollRef.current[groupId];
      if (saved?.channelKey === channelKey) continue;
      savedGroupScrollRef.current[groupId] = { channelKey, top: 0 };
      const scroller = groupScrollRefs.current[groupId];
      if (scroller) scroller.scrollTop = 0;
    }
  }, [channelKey]);

  const toggleGroup = useCallback((groupId: ActiveChatterGroupId) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const updateSearchQuery = useCallback(
    (query: string) => {
      setSearchQuery(query);
      for (const { id: groupId } of ACTIVE_CHATTER_SECTIONS) {
        const scroller = groupScrollRefs.current[groupId];
        if (scroller) scroller.scrollTop = 0;
        savedGroupScrollRef.current[groupId] = { channelKey, top: 0 };
      }
      visibleStartsByChannelRef.current[channelKey] = {
        ...INITIAL_ACTIVE_CHATTER_VISIBLE_STARTS,
      };
    },
    [channelKey]
  );

  const total = trackedTotal ?? Object.keys(chatters).length;
  const visibleTotal = groupedChatters.moderators.length + groupedChatters.chatters.length;
  const searching = trimmedSearchQuery.length > 0;

  return (
    <aside
      id={id}
      aria-label="Active Chatters"
      onWheel={(event) => event.stopPropagation()}
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[#171717]"
    >
      <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white">Active Chatters</h3>
          <p role="status" aria-live="polite" className="text-sm font-semibold text-neutral-300">
            {total === 0 ? "People appear as messages arrive" : `${total} seen in this chat`}
          </p>
        </div>
        {total > 0 ? (
          <search className="relative mt-2 block">
            <BsSearch
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-500"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => updateSearchQuery(event.currentTarget.value)}
              aria-label="Search active chatters"
              placeholder="Search chatters"
              className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[#252525] py-1.5 pl-8 pr-8 text-sm font-medium text-white placeholder:text-neutral-500 transition-colors duration-200 focus:border-white focus:outline-none focus:ring-1 focus:ring-white [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery.length > 0 ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  updateSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-neutral-400 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <BsX className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </search>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-white/5 text-neutral-500">
            <BsPeople className="size-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-neutral-300">No active chatters yet</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Live messages and loaded chat history will populate this list.
          </p>
        </div>
      ) : (
        <div
          aria-label="Active chatter groups"
          className="flex min-h-0 flex-1 flex-col overflow-y-hidden overscroll-y-contain px-2 py-2 [overflow-anchor:none]"
        >
          {searching && visibleTotal === 0 ? (
            <p
              role="status"
              aria-live="polite"
              className="mx-2 mb-2 rounded-md bg-white/5 px-3 py-2 text-sm font-medium text-neutral-300"
            >
              No active chatters match &quot;{trimmedSearchQuery}&quot;.
            </p>
          ) : null}
          {ACTIVE_CHATTER_SECTIONS.map(({ id: groupId, label }) => {
            const users = groupedChatters[groupId];
            const collapsed = collapsedGroups.has(groupId);
            const toggleId = `${id}-${groupId}-toggle`;
            const listId = `${id}-${groupId}-list`;
            return (
              <section
                key={groupId}
                aria-labelledby={toggleId}
                className="mb-3 flex min-h-0 flex-col last:mb-0"
              >
                <button
                  id={toggleId}
                  type="button"
                  aria-label={`${label}, ${users.length} ${users.length === 1 ? "chatter" : "chatters"}`}
                  aria-expanded={!collapsed}
                  aria-controls={listId}
                  onClick={() => toggleGroup(groupId)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-bold text-neutral-100 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#9146ff)]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <BsChevronDown
                      aria-hidden="true"
                      strokeWidth={3}
                      className={`size-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                    />
                    {groupId === "moderators" ? (
                      moderatorBadge ? (
                        <span className="flex size-4 shrink-0 items-center" aria-hidden="true">
                          <ProviderBadge badge={moderatorBadge} platform={platform} />
                        </span>
                      ) : (
                        <BsShieldFill
                          className="size-3.5 shrink-0 text-neutral-300"
                          aria-hidden="true"
                        />
                      )
                    ) : (
                      <BsPeople className="size-3.5 shrink-0 text-neutral-300" aria-hidden="true" />
                    )}
                    <span className="uppercase tracking-wide">{label}</span>
                  </span>
                  <span className="tabular-nums text-white" aria-hidden="true">
                    {users.length}
                  </span>
                </button>
                <ul
                  id={listId}
                  hidden={collapsed}
                  ref={(element) => {
                    groupScrollRefs.current[groupId] = element;
                    const saved = savedGroupScrollRef.current[groupId];
                    if (element && saved?.channelKey === channelKey) {
                      element.scrollTop = saved.top;
                    }
                  }}
                  aria-label={label}
                  onScroll={(event) => {
                    const top = event.currentTarget.scrollTop;
                    savedGroupScrollRef.current[groupId] = {
                      channelKey,
                      top,
                    };
                    const firstVisibleIndex = Math.floor(top / ACTIVE_CHATTER_ROW_HEIGHT_PX);
                    const visibleStarts =
                      visibleStartsByChannelRef.current[channelKey] ??
                      INITIAL_ACTIVE_CHATTER_VISIBLE_STARTS;
                    if (visibleStarts[groupId] !== firstVisibleIndex) {
                      visibleStartsByChannelRef.current[channelKey] = {
                        ...visibleStarts,
                        [groupId]: firstVisibleIndex,
                      };
                      setAvatarHydrationRevision((revision) => revision + 1);
                    }
                  }}
                  onWheel={(event) => event.stopPropagation()}
                  className="min-h-0 max-h-48 space-y-0.5 overflow-y-auto overscroll-y-contain [overflow-anchor:none]"
                >
                  {users.map((user) => (
                    <li
                      key={user.username.toLowerCase()}
                      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5"
                    >
                      <ProxiedImage
                        src={user.avatarUrl}
                        alt=""
                        className="size-6 shrink-0 rounded-full object-cover"
                        fallback={
                          <span
                            aria-hidden="true"
                            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-neutral-200"
                          >
                            {getChatterInitial(user)}
                          </span>
                        }
                        width={24}
                        height={24}
                      />
                      <span
                        className="min-w-0 truncate text-sm"
                        style={{
                          color: resolveChatUsernameColor({
                            color: user.color,
                            platform,
                            readableColorForUncolored: chatDisplay.readableColorForUncolored,
                            themeAdaptUsernameColor: chatDisplay.themeAdaptUsernameColor,
                            username: user.username,
                          }),
                        }}
                      >
                        {user.displayName || user.username}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}
