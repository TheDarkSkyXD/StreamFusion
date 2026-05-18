/**
 * MentionAutocomplete Component
 *
 * Provides autocomplete suggestions for @mentions.
 * Triggered by '@' character (e.g., '@user' shows matching chatters).
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatPlatform } from "../../shared/chat-types";
import { useChatStore } from "../../store/chat-store";

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
  /** Maximum number of suggestions to show */
  maxSuggestions?: number;
  /** Minimum characters after trigger before showing suggestions */
  minChars?: number;
}

// Max messages to scan when building the chatter list. Caps per-tick work below
// the chat-store's MESSAGE_LIMIT_NORMAL.
const RECENT_CHATTER_SCAN_LIMIT = 100;

export interface RecentChatter {
  /** Username (login) */
  username: string;
  /** Display name */
  displayName: string;
  /** User color */
  color?: string;
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
  maxSuggestions = 8,
  minChars = 0,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Snapshot the chatter list once when the popup activates, then keep it
  // stable until the popup closes. Subscribing to chat messages while typing
  // an @ would re-run this scan on every inbound message, which is exactly
  // what we are trying to avoid for high-volume chats.
  const recentChatters: RecentChatter[] = useMemo(() => {
    if (!isActive) return [];
    const messages = useChatStore.getState().messages;
    const chatterMap = new Map<string, RecentChatter>();
    const start = Math.max(0, messages.length - RECENT_CHATTER_SCAN_LIMIT);
    for (let i = messages.length - 1; i >= start; i--) {
      const msg = messages[i];
      if (msg.type !== "message" || msg.platform !== platform) continue;
      if (!chatterMap.has(msg.username)) {
        chatterMap.set(msg.username, {
          username: msg.username,
          displayName: msg.displayName,
          color: msg.color,
          lastSeen: msg.timestamp,
        });
      }
    }
    return Array.from(chatterMap.values());
  }, [isActive, platform]);

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
      })
      .slice(0, maxSuggestions);

    return filtered;
  }, [match, recentChatters, maxSuggestions]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  // Latest-ref pattern: hold mutable values the listener reads in a single
  // ref so the registration effect can depend on `isActive` only. Without
  // this, every keystroke that mutates suggestions/selectedIndex/match would
  // recreate handleKeyDown and force document-level listener churn.
  const latestRef = useRef({
    suggestions,
    selectedIndex,
    match,
    onSelect,
    onClose,
  });
  latestRef.current = { suggestions, selectedIndex, match, onSelect, onClose };

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
  if (!isActive || !match || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full mb-1 left-0 w-full max-w-xs bg-[var(--color-background-secondary)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 overflow-hidden"
      role="listbox"
      aria-label="User suggestions"
    >
      {/* Header */}
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-[var(--color-border)] flex justify-between">
        <span>Users matching &quot;{match.query}&quot;</span>
        <span className="text-gray-600">↑↓ to navigate, Tab/Enter to select</span>
      </div>

      {/* Suggestions */}
      <div className="py-1 max-h-48 overflow-y-auto">
        {suggestions.map((chatter, index) => (
          <MentionAutocompleteItem
            key={chatter.username}
            chatter={chatter}
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
  isSelected: boolean;
  index: number;
  onClick: () => void;
  onHover: () => void;
}

const MentionAutocompleteItem: React.FC<MentionAutocompleteItemProps> = ({
  chatter,
  isSelected,
  index,
  onClick,
  onHover,
}) => {
  return (
    <div
      data-index={index}
      role="option"
      aria-selected={isSelected}
      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
        isSelected ? "bg-white/10" : "hover:bg-white/5"
      }`}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      {/* User avatar placeholder */}
      <div
        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
        style={{ backgroundColor: chatter.color || "#666" }}
      >
        {chatter.displayName.charAt(0).toUpperCase()}
      </div>

      {/* User info */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate" style={{ color: chatter.color || "white" }}>
          {chatter.displayName}
        </span>
        {chatter.displayName.toLowerCase() !== chatter.username.toLowerCase() && (
          <span className="text-xs text-gray-500 ml-1">@{chatter.username}</span>
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
