import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BsChevronDown, BsPeople, BsX } from "react-icons/bs";

import type { ChatKnownUser, ChatKnownUserRole } from "../../../../../shared/chat-types";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../../../../shared/auth-types";
import { resolveChatUsernameColor } from "../../utils/chat-visuals";
import { useAuthStore } from "../../../../store/auth-store";
import { useChatStore } from "../../../../store/chat-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { ChatBadge as ProviderBadge } from "./ChatBadge";

const EMPTY_CHATTERS: Record<string, ChatKnownUser> = {};

const ROLE_SECTIONS: ReadonlyArray<{
  role: ChatKnownUserRole;
  label: string;
}> = [
  { role: "broadcaster", label: "Broadcaster" },
  { role: "moderator", label: "Moderators" },
  { role: "subscriber", label: "Subscribers" },
  { role: "viewer", label: "Viewers" },
];

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
          aria-label={open ? "Hide recent chatters" : "Show recent chatters"}
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
      <TooltipContent side="bottom">Recent Chatters</TooltipContent>
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
  const chatDisplay =
    useAuthStore((state) => state.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
  const [collapsedRoles, setCollapsedRoles] = useState<ReadonlySet<ChatKnownUserRole>>(
    () => new Set()
  );
  const roleScrollRefs = useRef<Partial<Record<ChatKnownUserRole, HTMLUListElement | null>>>({});
  const savedRoleScrollRef = useRef<
    Partial<Record<ChatKnownUserRole, { channelKey: string; top: number }>>
  >({});
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const platform = channelKey.startsWith("twitch:") ? "twitch" : "kick";

  const groupedChatters = useMemo(() => {
    const groups: Record<ChatKnownUserRole, ChatKnownUser[]> = {
      broadcaster: [],
      moderator: [],
      subscriber: [],
      viewer: [],
    };

    for (const chatter of Object.values(chatters)) {
      groups[chatter.role ?? "viewer"].push(chatter);
    }
    for (const group of Object.values(groups)) {
      group.sort((left, right) => right.lastSeen.getTime() - left.lastSeen.getTime());
    }
    return groups;
  }, [chatters]);

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
    for (const { role } of ROLE_SECTIONS) {
      const saved = savedRoleScrollRef.current[role];
      if (saved?.channelKey === channelKey) continue;
      savedRoleScrollRef.current[role] = { channelKey, top: 0 };
      const scroller = roleScrollRefs.current[role];
      if (scroller) scroller.scrollTop = 0;
    }
  }, [channelKey]);

  const toggleRole = useCallback((role: ChatKnownUserRole) => {
    setCollapsedRoles((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }, []);

  const total = trackedTotal ?? Object.keys(chatters).length;

  return (
    <aside
      id={id}
      aria-label="Recent Chatters"
      onWheel={(event) => event.stopPropagation()}
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[#171717]"
    >
      <div className="flex shrink-0 items-center border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white">Recent Chatters</h3>
          <p role="status" aria-live="polite" className="text-sm font-semibold text-neutral-300">
            {total === 0 ? "People appear as messages arrive" : `${total} seen in this chat`}
          </p>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-white/5 text-neutral-500">
            <BsPeople className="size-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-neutral-300">No recent chatters yet</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Live messages and loaded chat history will populate this list.
          </p>
        </div>
      ) : (
        <div
          aria-label="Recent chatter groups"
          className="flex min-h-0 flex-1 flex-col overflow-y-hidden overscroll-y-contain px-2 py-2 [overflow-anchor:none]"
        >
          {ROLE_SECTIONS.map(({ role, label }) => {
            const users = groupedChatters[role];
            if (users.length === 0) return null;
            const collapsed = collapsedRoles.has(role);
            const toggleId = `${id}-${role}-toggle`;
            const listId = `${id}-${role}-list`;
            return (
              <section
                key={role}
                aria-labelledby={toggleId}
                className="mb-3 flex min-h-0 flex-col last:mb-0"
              >
                <button
                  id={toggleId}
                  type="button"
                  aria-label={`${label}, ${users.length} ${users.length === 1 ? "chatter" : "chatters"}`}
                  aria-expanded={!collapsed}
                  aria-controls={listId}
                  onClick={() => toggleRole(role)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-bold text-neutral-100 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#9146ff)]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <BsChevronDown
                      aria-hidden="true"
                      strokeWidth={3}
                      className={`size-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                    />
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
                    roleScrollRefs.current[role] = element;
                    const saved = savedRoleScrollRef.current[role];
                    if (element && saved?.channelKey === channelKey) {
                      element.scrollTop = saved.top;
                    }
                  }}
                  aria-label={label}
                  onScroll={(event) => {
                    savedRoleScrollRef.current[role] = {
                      channelKey,
                      top: event.currentTarget.scrollTop,
                    };
                  }}
                  onWheel={(event) => event.stopPropagation()}
                  className="min-h-0 max-h-48 space-y-0.5 overflow-y-auto overscroll-y-contain [overflow-anchor:none]"
                >
                  {users.map((user) => (
                    <li
                      key={user.username.toLowerCase()}
                      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5"
                    >
                      {(user.badges ?? []).some((badge) => Boolean(badge.imageUrl)) ? (
                        <span className="flex shrink-0 items-center gap-1">
                          {(user.badges ?? []).map((badge) => (
                            <ProviderBadge
                              key={`${badge.setId}:${badge.version}:${badge.imageUrl}`}
                              badge={badge}
                              platform={platform}
                            />
                          ))}
                        </span>
                      ) : null}
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
