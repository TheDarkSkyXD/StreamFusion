/**
 * MentionAutocomplete Component
 *
 * Provides autocomplete suggestions for @mentions.
 * Triggered by '@' character (e.g., '@user' shows matching chatters).
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProxiedImage } from "@/components/ui/proxied-image";
import type { ChatPlatform } from "../../shared/chat-types";
import { buildChannelKey, useChatStore } from "../../store/chat-store";

interface MentionAutocompleteProps {
  /** Current input value */
  inputValue: string;
  /** Cursor position in the input */
  cursorPosition: number;
  /** Called when a user is selected */
  onSelect: (username: string, startPos: number, endPos: number) => void;
  /** Called when autocomplete should close */
  onClose: () => void;
  /** Whether autocomplete is active */
  isActive: boolean;
  /** Platform to filter chatters by */
  platform: ChatPlatform;
  /** Channel whose chatters should be suggested */
  channel: string;
  /** Number of suggestions to show before scroll-loading more */
  maxSuggestions?: number;
  /** Minimum characters after trigger before showing suggestions */
  minChars?: number;
}

const SCROLL_LOAD_THRESHOLD_PX = 24;
const KICK_DEFAULT_AVATAR_URL =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20rx%3D%2224%22%20fill%3D%22%2353FC18%22%2F%3E%3Ccircle%20cx%3D%2224%22%20cy%3D%2218%22%20r%3D%228%22%20fill%3D%22%23101510%22%2F%3E%3Cpath%20d%3D%22M10%2041c2.4-9%207.2-13%2014-13s11.6%204%2014%2013%22%20fill%3D%22%23101510%22%2F%3E%3C%2Fsvg%3E";

export interface RecentChatter {
  /** Platform user ID */
  userId: string;
  /** Username (login) */
  username: string;
  /** Display name */
  displayName: string;
  /** User color */
  color?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Last seen timestamp */
  lastSeen: Date;
}

interface AutocompleteMatch {
  query: string;
  startPos: number;
  endPos: number;
}

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  inputValue,
  cursorPosition,
  onSelect,
  onClose,
  isActive,
  platform,
  channel,
  maxSuggestions = 8,
  minChars = 0,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(maxSuggestions);
  const [enrichedUsers, setEnrichedUsers] = useState<Record<string, Partial<RecentChatter>>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Snapshot the chatter list once when the popup activates, then keep it
  // stable until the popup closes. Subscribing to chat messages while typing
  // an @ would re-run this scan on every inbound message, which is exactly
  // what we are trying to avoid for high-volume chats.
  const recentChatters: RecentChatter[] = useMemo(() => {
    if (!isActive) return [];
    const channelKey = buildChannelKey(platform, channel);
    const state = useChatStore.getState();
    const usersByUsername = new Map<string, RecentChatter>();
    const knownUsers = state.usersByChannel[channelKey] ?? {};
    for (const user of Object.values(knownUsers)) {
      usersByUsername.set(user.username.toLowerCase(), {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        color: user.color,
        avatarUrl: user.avatarUrl,
        lastSeen: user.lastSeen,
      });
    }

    const messages = state.messagesByChannel[channelKey] ?? [];
    const chatterMap = new Map<string, RecentChatter>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type !== "message") continue;
      const key = msg.username.toLowerCase();
      if (!chatterMap.has(key)) {
        const known = usersByUsername.get(key);
        chatterMap.set(key, {
          userId: msg.userId,
          username: msg.username,
          displayName: msg.displayName,
          color: msg.color || known?.color,
          avatarUrl: msg.avatarUrl || known?.avatarUrl,
          lastSeen: msg.timestamp,
        });
      }
    }

    for (const [key, user] of usersByUsername) {
      if (!chatterMap.has(key)) {
        chatterMap.set(key, user);
      }
    }

    return Array.from(chatterMap.values()).map((chatter) => {
      const enriched = enrichedUsers[chatter.username.toLowerCase()];
      return enriched ? { ...chatter, ...enriched } : chatter;
    });
  }, [channel, enrichedUsers, isActive, platform]);

  // Find the current autocomplete match (text after @)
  const match = useMemo((): AutocompleteMatch | null => {
    if (!isActive || !inputValue) return null;

    // Look backwards from cursor to find @ character
    let startPos = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      const char = inputValue[i];

      // Stop at whitespace - no match
      if (/\s/.test(char)) {
        break;
      }

      // Found trigger
      if (char === "@") {
        startPos = i;
        break;
      }
    }

    if (startPos === -1) return null;

    // Extract the query (text between @ and cursor)
    const query = inputValue.slice(startPos + 1, cursorPosition);

    // Check minimum characters requirement
    if (query.length < minChars) return null;

    return {
      query,
      startPos,
      endPos: cursorPosition,
    };
  }, [inputValue, cursorPosition, isActive, minChars]);

  // Get suggestions based on the match
  const suggestions = useMemo(() => {
    if (!match) return [];

    const query = match.query.toLowerCase();

    // Filter and sort recent chatters
    const filtered = recentChatters
      .filter(
        (chatter) =>
          chatter.username.toLowerCase().includes(query) ||
          chatter.displayName.toLowerCase().includes(query)
      )
      .sort((a, b) => {
        // Prioritize exact prefix matches
        const aStartsWithQuery =
          a.username.toLowerCase().startsWith(query) ||
          a.displayName.toLowerCase().startsWith(query);
        const bStartsWithQuery =
          b.username.toLowerCase().startsWith(query) ||
          b.displayName.toLowerCase().startsWith(query);

        if (aStartsWithQuery && !bStartsWithQuery) return -1;
        if (!aStartsWithQuery && bStartsWithQuery) return 1;

        // Then sort by most recent
        return b.lastSeen.getTime() - a.lastSeen.getTime();
      });

    return filtered;
  }, [match, recentChatters]);

  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, visibleCount),
    [suggestions, visibleCount]
  );
  const resetKey = `${platform}:${channel}:${isActive}:${match?.query ?? ""}:${maxSuggestions}`;

  useEffect(() => {
    void resetKey;
    setVisibleCount(maxSuggestions);
    setSelectedIndex(0);
  }, [resetKey, maxSuggestions]);

  useEffect(() => {
    if (!isActive || visibleSuggestions.length === 0) return;
    const api = globalThis.window?.electronAPI?.chat;
    if (!api?.enrichMentionUsers) return;

    let cancelled = false;
    const users = visibleSuggestions
      .filter((chatter) => !chatter.avatarUrl)
      .map((chatter) => ({
        userId: chatter.userId,
        username: chatter.username,
      }));
    if (users.length === 0) return;

    void api.enrichMentionUsers({ platform, channel, users }).then((result) => {
      if (cancelled || !result.success || !result.data) return;
      setEnrichedUsers((prev) => {
        const next = { ...prev };
        for (const user of result.data ?? []) {
          next[user.username.toLowerCase()] = {
            userId: user.userId,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          };
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [channel, isActive, platform, visibleSuggestions]);

  // Latest-ref pattern: hold mutable values the listener reads in a single
  // ref so the registration effect can depend on `isActive` only. Without
  // this, every keystroke that mutates suggestions/selectedIndex/match would
  // recreate handleKeyDown and force document-level listener churn.
  const latestRef = useRef({
    suggestions: visibleSuggestions,
    selectedIndex,
    match,
    onSelect,
    onClose,
  });
  latestRef.current = {
    suggestions: visibleSuggestions,
    selectedIndex,
    match,
    onSelect,
    onClose,
  };

  // Register keyboard handler exactly once per active session.
  useEffect(() => {
    if (!isActive) return;

    const handler = (e: KeyboardEvent) => {
      const {
        suggestions: curSuggestions,
        selectedIndex: curIndex,
        match: curMatch,
        onSelect: curOnSelect,
        onClose: curOnClose,
      } = latestRef.current;
      if (curSuggestions.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < curSuggestions.length - 1 ? prev + 1 : 0));
          break;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : curSuggestions.length - 1));
          break;

        case "Tab":
        case "Enter":
          if (curMatch && curSuggestions[curIndex]) {
            e.preventDefault();
            curOnSelect(curSuggestions[curIndex].username, curMatch.startPos, curMatch.endPos);
          }
          break;

        case "Escape":
          e.preventDefault();
          curOnClose();
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isActive]);

  // Scroll selected item into view
  useEffect(() => {
    if (containerRef.current) {
      const selectedEl = containerRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  const handleSuggestionsScroll = useCallback(() => {
    const el = suggestionsRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > SCROLL_LOAD_THRESHOLD_PX) return;
    setVisibleCount((prev) => Math.min(prev + maxSuggestions, suggestions.length));
  }, [maxSuggestions, suggestions.length]);

  // Handle user click
  const handleUserClick = useCallback(
    (username: string, index: number) => {
      if (match) {
        setSelectedIndex(index);
        onSelect(username, match.startPos, match.endPos);
      }
    },
    [match, onSelect]
  );

  // Don't render if no active match or no suggestions
  if (!isActive || !match || visibleSuggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-1 w-full max-w-none overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] shadow-xl z-50"
      role="listbox"
      aria-label="User suggestions"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-neutral-500">
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          Users matching &quot;{match.query}&quot;
        </span>
        <span className="text-neutral-600">↑↓ to navigate, Tab/Enter to select</span>
      </div>

      {/* Suggestions */}
      <div
        ref={suggestionsRef}
        className={`py-1 ${
          suggestions.length > maxSuggestions ? "max-h-64 overflow-y-auto" : "overflow-visible"
        }`}
        onScroll={handleSuggestionsScroll}
      >
        {visibleSuggestions.map((chatter, index) => (
          <MentionAutocompleteItem
            key={chatter.username}
            chatter={chatter}
            platform={platform}
            isSelected={index === selectedIndex}
            index={index}
            onClick={() => handleUserClick(chatter.username, index)}
            onHover={() => setSelectedIndex(index)}
          />
        ))}
      </div>
    </div>
  );
};

/** Individual autocomplete suggestion item */
interface MentionAutocompleteItemProps {
  chatter: RecentChatter;
  platform: ChatPlatform;
  isSelected: boolean;
  index: number;
  onClick: () => void;
  onHover: () => void;
}

const MentionAutocompleteItem: React.FC<MentionAutocompleteItemProps> = ({
  chatter,
  platform,
  isSelected,
  index,
  onClick,
  onHover,
}) => {
  const avatarUrl =
    chatter.avatarUrl || (platform === "kick" ? KICK_DEFAULT_AVATAR_URL : undefined);

  return (
    <div
      data-index={index}
      role="option"
      aria-selected={isSelected}
      className={`flex cursor-pointer items-start gap-2 px-3 py-2 transition-colors ${
        isSelected ? "bg-white/10" : "hover:bg-white/5"
      }`}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      <ProxiedImage
        src={avatarUrl}
        alt={chatter.displayName}
        className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-full object-cover"
        fallback={
          <div
            className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
            style={{ backgroundColor: chatter.color || "#666" }}
          >
            {chatter.displayName.charAt(0).toUpperCase()}
          </div>
        }
        width={24}
        height={24}
      />

      {/* User info */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <span
          className="block break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]"
          style={{ color: chatter.color || "white" }}
        >
          {chatter.displayName}
        </span>
        {chatter.displayName.toLowerCase() !== chatter.username.toLowerCase() && (
          <span className="block break-words text-xs leading-snug text-neutral-500 [overflow-wrap:anywhere]">
            @{chatter.username}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Hook to manage mention autocomplete state
 */
export function useMentionAutocomplete() {
  const [isActive, setIsActive] = useState(false);

  const activate = useCallback(() => setIsActive(true), []);
  const deactivate = useCallback(() => setIsActive(false), []);

  /**
   * Check if input should trigger autocomplete
   */
  const checkTrigger = useCallback((value: string, cursorPos: number) => {
    // Look backwards from cursor for @ char
    for (let i = cursorPos - 1; i >= 0; i--) {
      const char = value[i];

      // Stop at whitespace
      if (/\s/.test(char)) {
        setIsActive(false);
        return;
      }

      // Found trigger
      if (char === "@") {
        setIsActive(true);
        return;
      }
    }

    setIsActive(false);
  }, []);

  return {
    isActive,
    activate,
    deactivate,
    checkTrigger,
  };
}

export default MentionAutocomplete;
