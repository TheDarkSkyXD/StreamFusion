import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Emote, EmoteProvider } from "../../../../../backend/services/emotes/emote-types";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { useEmoteStore } from "../../../../store/emote-store";
import { EmoteImage } from "./EmoteImage";
import { getContextualEmoteMatch } from "./contextual-emote-mode";

const MAX_RESULTS = 9;
const PROVIDERS_BY_PLATFORM: Record<ChatPlatform, ReadonlySet<EmoteProvider>> = {
  twitch: new Set(["twitch", "7tv", "bttv", "ffz"]),
  kick: new Set(["kick", "7tv"]),
};

function isUsableCandidate(emote: Emote, viewerIsSubscribed: boolean | undefined): boolean {
  if (!emote.subscribersOnly || emote.availability === "user") return true;
  return viewerIsSubscribed === true;
}

function rankMatches(emotes: Emote[], query: string): Emote[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return emotes
    .filter((emote) => emote.name.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftName = left.name.toLocaleLowerCase();
      const rightName = right.name.toLocaleLowerCase();
      const score = (name: string) =>
        name === normalizedQuery ? 0 : name.startsWith(normalizedQuery) ? 1 : 2;
      return score(leftName) - score(rightName) || left.name.localeCompare(right.name);
    })
    .slice(0, MAX_RESULTS);
}

function formatProvider(provider: EmoteProvider): string {
  if (provider === "7tv") return "7TV";
  if (provider === "bttv") return "BTTV";
  if (provider === "ffz") return "FFZ";
  return provider[0].toUpperCase() + provider.slice(1);
}

interface ContextualEmoteRowProps {
  inputValue: string;
  cursorPosition: number;
  platform: ChatPlatform;
  channelId: string;
  viewerIsSubscribed?: boolean;
  keyboardActive?: boolean;
  fallback?: React.ReactNode;
  onResultCountChange?: (count: number) => void;
  onSelect: (emote: Emote, startPos: number, endPos: number) => void;
  onClose: () => void;
}

export const ContextualEmoteRow: React.FC<ContextualEmoteRowProps> = ({
  inputValue,
  cursorPosition,
  platform,
  channelId,
  viewerIsSubscribed,
  keyboardActive = true,
  fallback = null,
  onResultCountChange,
  onSelect,
  onClose,
}) => {
  const isLoading = useEmoteStore(
    (state) =>
      state.isLoading &&
      (!state.loadedGlobalPlatforms.has(platform) || !state.loadedChannels.has(channelId))
  );
  const emoteRevision = useEmoteStore((state) => state.emoteRevision);
  const getEmotesByProviderForChannel = useEmoteStore(
    (state) => state.getEmotesByProviderForChannel
  );
  const [selection, setSelection] = useState({ identityKey: "", index: 0 });
  const match = useMemo(
    () => getContextualEmoteMatch(inputValue, cursorPosition),
    [cursorPosition, inputValue]
  );

  const suggestions = useMemo(() => {
    if (!match) return [];
    void emoteRevision;
    const providers = PROVIDERS_BY_PLATFORM[platform];
    const grouped = getEmotesByProviderForChannel(channelId);
    const candidates: Emote[] = [];
    for (const [provider, emotes] of grouped) {
      if (!providers.has(provider)) continue;
      candidates.push(...emotes.filter((emote) => isUsableCandidate(emote, viewerIsSubscribed)));
    }
    return rankMatches(candidates, match.query);
  }, [
    channelId,
    emoteRevision,
    getEmotesByProviderForChannel,
    match,
    platform,
    viewerIsSubscribed,
  ]);
  const suggestionIdentityKey = suggestions
    .map((emote) => `${emote.provider}:${emote.id}`)
    .join("\u001f");
  const safeSelectedIndex =
    suggestions.length === 0 || selection.identityKey !== suggestionIdentityKey
      ? 0
      : Math.min(selection.index, suggestions.length - 1);

  useLayoutEffect(() => {
    onResultCountChange?.(suggestions.length);
  }, [onResultCountChange, suggestions.length]);

  const select = useCallback(
    (emote: Emote) => {
      if (!match) return;
      onSelect(emote, match.startPos, match.endPos);
    },
    [match, onSelect]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!match || !keyboardActive) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (suggestions.length === 0) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        setSelection((current) => {
          const currentIndex = current.identityKey === suggestionIdentityKey ? current.index : 0;
          return {
            identityKey: suggestionIdentityKey,
            index: (currentIndex + direction + suggestions.length) % suggestions.length,
          };
        });
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [keyboardActive, match, onClose, suggestionIdentityKey, suggestions]);

  if (!match) return null;
  if (!match.explicit && !isLoading && suggestions.length === 0) return fallback;

  const duplicateNames = new Set(
    suggestions
      .filter(
        (candidate, index) =>
          suggestions.findIndex((other) => other.name === candidate.name) !== index
      )
      .map((emote) => emote.name)
  );
  const announcedSelection = suggestions[safeSelectedIndex];
  const announcement = isLoading
    ? "Loading emote suggestions"
    : suggestions.length === 0
      ? "No matching emotes"
      : `${suggestions.length} emote suggestions. ${announcedSelection.name} from ${formatProvider(announcedSelection.provider)} selected, identity ${announcedSelection.provider}:${announcedSelection.id}. Click to insert.`;

  return (
    <div
      className="flex h-8 min-h-8 items-center overflow-hidden px-1"
      data-testid="contextual-emote-row"
      data-platform={platform}
      data-channel-id={channelId}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {isLoading ? (
        <span className="text-xs text-neutral-400">Loading emotes…</span>
      ) : suggestions.length === 0 ? (
        <span className="text-xs text-neutral-400">No matching emotes</span>
      ) : (
        <div
          className="flex h-full min-w-0 items-center gap-0.5 overflow-hidden"
          data-testid="contextual-emote-results"
          role="listbox"
          aria-label={`Emotes matching ${match.query}`}
        >
          {suggestions.map((emote, index) => {
            const identity = `${emote.provider}:${emote.id}`;
            const providerName = formatProvider(emote.provider);
            const actionLabel = `Insert ${emote.name} from ${providerName}`;
            return (
              <button
                key={identity}
                type="button"
                role="option"
                aria-selected={index === safeSelectedIndex}
                aria-label={actionLabel}
                title={actionLabel}
                data-emote-key={identity}
                onMouseEnter={() => setSelection({ identityKey: suggestionIdentityKey, index })}
                onClick={() => select(emote)}
                className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border bg-transparent p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  index === safeSelectedIndex ? "border-white/40 bg-white/10" : "border-transparent"
                }`}
              >
                <EmoteImage emote={emote} size="quick" lazyLoad={false} showTooltip={false} />
                {duplicateNames.has(emote.name) && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 right-0 rounded-sm bg-black/80 px-0.5 text-[7px] font-bold uppercase text-white"
                  >
                    {providerName}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
