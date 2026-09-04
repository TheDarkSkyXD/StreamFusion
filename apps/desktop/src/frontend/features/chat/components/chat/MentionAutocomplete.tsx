import { useTranslation } from "react-i18next";
/**
 * MentionAutocomplete Component
 *
 * Provides autocomplete suggestions for @mentions.
 * Triggered by '@' character (e.g., '@user' shows matching chatters).
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import { getMentionSuggestions, type RecentChatter } from "./mention-suggestions";

interface MentionAutocompleteProps {
  /** Current input value */
  inputValue: string;
  /** Cursor position in the input */
  cursorPosition: number;
  /** Called when a user is selected */
  onSelect: (username: string, startPos: number, endPos: number) => void;
  selectedKey?: string | null;
  onSelectedKeyChange?: (key: string) => void;
  onClose?: () => void;
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

const noopSelectedKeyChange = () => {};

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  inputValue,
  cursorPosition,
  onSelect,
  selectedKey,
  onSelectedKeyChange = noopSelectedKeyChange,
  isActive,
  platform,
  channel,
  maxSuggestions = 8,
  minChars = 0,
}) => {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(maxSuggestions);
  const [enrichedUsers, setEnrichedUsers] = useState<Record<string, Partial<RecentChatter>>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const completion = useMemo(
    () =>
      isActive
        ? getMentionSuggestions({ inputValue, cursorPosition, platform, channel, minChars })
        : { match: null, suggestions: [] },
    [channel, cursorPosition, inputValue, isActive, minChars, platform]
  );
  const match = completion.match;
  const suggestions = useMemo(
    () =>
      completion.suggestions.map((chatter) => {
        const enriched = enrichedUsers[chatter.username.toLowerCase()];
        return enriched ? { ...chatter, ...enriched } : chatter;
      }),
    [completion.suggestions, enrichedUsers]
  );

  const selectedSuggestionIndex = selectedKey
    ? suggestions.findIndex((suggestion) => suggestion.username === selectedKey)
    : -1;
  const effectiveVisibleCount = Math.max(visibleCount, selectedSuggestionIndex + 1);
  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, effectiveVisibleCount),
    [effectiveVisibleCount, suggestions]
  );
  const resetKey = `${platform}:${channel}:${isActive}:${match?.query ?? ""}:${maxSuggestions}`;

  useEffect(() => {
    void resetKey;
    setVisibleCount(maxSuggestions);
  }, [resetKey, maxSuggestions]);

  useEffect(() => {
    if (!isActive || visibleSuggestions.length === 0) return;
    const api = globalThis.window?.electronAPI?.chat;
    if (!api?.enrichMentionUsers) return;

    let cancelled = false;
    const users: Array<{ userId: string; username: string }> = [];
    for (const chatter of visibleSuggestions) {
      if (!chatter.avatarUrl) users.push({ userId: chatter.userId, username: chatter.username });
    }
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

  useEffect(() => {
    if (!containerRef.current || !selectedKey) return;
    const selectedEl = containerRef.current.querySelector(`[data-key="${selectedKey}"]`);
    selectedEl?.scrollIntoView({ block: "nearest" });
  }, [selectedKey, visibleSuggestions.length]);

  const handleSuggestionsScroll = useCallback(() => {
    const el = suggestionsRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > SCROLL_LOAD_THRESHOLD_PX) return;
    setVisibleCount((prev) => Math.min(prev + maxSuggestions, suggestions.length));
  }, [maxSuggestions, suggestions.length]);

  // Handle user click
  const handleUserClick = useCallback(
    (username: string) => {
      if (match) {
        onSelectedKeyChange(username);
        onSelect(username, match.start, match.end);
      }
    },
    [match, onSelect, onSelectedKeyChange]
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
      aria-label={t("chat.userSuggestions")}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-3 py-1.5 text-xs text-neutral-500">
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          {t("chat.usersMatching", { query: match.query })}
        </span>
        <span className="text-neutral-600">{t("chat.toNavigateTabEnterToSelect")}</span>
      </div>

      {/* Suggestions */}
      <div
        ref={suggestionsRef}
        className={`py-1 ${
          suggestions.length > maxSuggestions ? "max-h-64 overflow-y-auto" : "overflow-visible"
        }`}
        onScroll={handleSuggestionsScroll}
      >
        {visibleSuggestions.map((chatter) => (
          <MentionAutocompleteItem
            key={chatter.username}
            chatter={chatter}
            platform={platform}
            isSelected={chatter.username === selectedKey}
            onClick={() => handleUserClick(chatter.username)}
            onHover={() => onSelectedKeyChange(chatter.username)}
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
  onClick: () => void;
  onHover: () => void;
}

const MentionAutocompleteItem: React.FC<MentionAutocompleteItemProps> = ({
  chatter,
  platform,
  isSelected,
  onClick,
  onHover,
}) => {
  const avatarUrl =
    chatter.avatarUrl || (platform === "kick" ? KICK_DEFAULT_AVATAR_URL : undefined);

  return (
    <div
      data-key={chatter.username}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
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

export default MentionAutocomplete;
