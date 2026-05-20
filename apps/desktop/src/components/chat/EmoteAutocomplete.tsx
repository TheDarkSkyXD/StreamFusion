/**
 * EmoteAutocomplete Component
 *
 * Provides autocomplete suggestions for emotes when typing.
 * Triggered by ':' character (e.g., ':Kappa' shows matching emotes).
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Emote } from "../../backend/services/emotes/emote-types";
import { useEmoteStore } from "../../store/emote-store";
import { EmoteImage } from "./EmoteImage";

interface EmoteAutocompleteProps {
  /** Current input value */
  inputValue: string;
  /** Cursor position in the input */
  cursorPosition: number;
  /** Called when an emote is selected */
  onSelect: (emote: Emote, startPos: number, endPos: number) => void;
  /** Called when autocomplete should close */
  onClose: () => void;
  /** Whether autocomplete is active */
  isActive: boolean;
  /** Maximum number of suggestions to show */
  maxSuggestions?: number;
  /** Trigger character (default: ':') */
  triggerChar?: string;
  /** Minimum characters after trigger before showing suggestions */
  minChars?: number;
}

interface AutocompleteMatch {
  query: string;
  startPos: number;
  endPos: number;
}

export const EmoteAutocomplete: React.FC<EmoteAutocompleteProps> = ({
  inputValue,
  cursorPosition,
  onSelect,
  onClose,
  isActive,
  maxSuggestions = 8,
  triggerChar = ":",
  minChars = 1,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { searchEmotes, loadedChannels, activeChannelId } = useEmoteStore();

  // Find the current autocomplete match (text after trigger char)
  const match = useMemo((): AutocompleteMatch | null => {
    if (!isActive || !inputValue) return null;

    // Look backwards from cursor to find trigger character
    let startPos = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      const char = inputValue[i];

      // Stop at whitespace - no match
      if (/\s/.test(char)) {
        break;
      }

      // Found trigger
      if (char === triggerChar) {
        startPos = i;
        break;
      }
    }

    if (startPos === -1) return null;

    // Extract the query (text between trigger and cursor)
    const query = inputValue.slice(startPos + 1, cursorPosition);

    // Check minimum characters requirement
    if (query.length < minChars) return null;

    return {
      query,
      startPos,
      endPos: cursorPosition,
    };
  }, [inputValue, cursorPosition, isActive, triggerChar, minChars]);

  // Get suggestions based on the match
  const suggestions = useMemo(() => {
    if (!match || !match.query) return [];
    return searchEmotes(match.query, maxSuggestions);
  }, [match, searchEmotes, maxSuggestions]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive || suggestions.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
          break;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
          break;

        case "Tab":
        case "Enter":
          if (match && suggestions[selectedIndex]) {
            e.preventDefault();
            onSelect(suggestions[selectedIndex], match.startPos, match.endPos);
          }
          break;

        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [isActive, suggestions, selectedIndex, match, onSelect, onClose]
  );

  // Register keyboard handler
  useEffect(() => {
    if (isActive) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActive, handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    if (containerRef.current) {
      const selectedEl = containerRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  // Handle emote click
  const handleEmoteClick = useCallback(
    (emote: Emote, index: number) => {
      if (match) {
        setSelectedIndex(index);
        onSelect(emote, match.startPos, match.endPos);
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
      aria-label="Emote suggestions"
    >
      {/* Header */}
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-[var(--color-border)] flex justify-between">
        <span>Emotes matching &quot;{match.query}&quot;</span>
        <span className="text-gray-600">↑↓ to navigate, Tab/Enter to select</span>
      </div>

      {/* Suggestions */}
      <div className="py-1 max-h-48 overflow-y-auto">
        {suggestions.map((emote, index) => (
          <EmoteAutocompleteItem
            key={`${emote.provider}-${emote.id}`}
            emote={emote}
            isSelected={index === selectedIndex}
            index={index}
            onClick={() => handleEmoteClick(emote, index)}
            onHover={() => setSelectedIndex(index)}
          />
        ))}
      </div>
    </div>
  );
};

/** Individual autocomplete suggestion item */
interface EmoteAutocompleteItemProps {
  emote: Emote;
  isSelected: boolean;
  index: number;
  onClick: () => void;
  onHover: () => void;
}

const EmoteAutocompleteItem: React.FC<EmoteAutocompleteItemProps> = ({
  emote,
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
      {/* Emote image */}
      <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
        <EmoteImage emote={emote} size="medium" showTooltip={false} lazyLoad={false} />
      </div>

      {/* Emote name */}
      <span className="flex-1 text-sm text-white truncate">{emote.name}</span>

      {/* Provider badge */}
      <span
        className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded"
        style={{
          backgroundColor: `${getProviderColor(emote.provider)}30`,
          color: getProviderColor(emote.provider),
        }}
      >
        {emote.provider.toUpperCase()}
      </span>
    </div>
  );
};

/** Get provider color */
function getProviderColor(provider: string): string {
  const colors: Record<string, string> = {
    twitch: "#9146FF",
    kick: "#53FC18",
    bttv: "#D50014",
    ffz: "#5D8FBC",
    "7tv": "#29B6F6",
  };
  return colors[provider] || "#666";
}

/**
 * Hook to manage emote autocomplete state
 */
export function useEmoteAutocomplete() {
  const [isActive, setIsActive] = useState(false);

  const activate = useCallback(() => setIsActive(true), []);
  const deactivate = useCallback(() => setIsActive(false), []);

  /**
   * Check if input should trigger autocomplete
   */
  const checkTrigger = useCallback((value: string, cursorPos: number, triggerChar = ":") => {
    // Look backwards from cursor for trigger char
    for (let i = cursorPos - 1; i >= 0; i--) {
      const char = value[i];

      // Stop at whitespace
      if (/\s/.test(char)) {
        setIsActive(false);
        return;
      }

      // Found trigger
      if (char === triggerChar) {
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

export default EmoteAutocomplete;
