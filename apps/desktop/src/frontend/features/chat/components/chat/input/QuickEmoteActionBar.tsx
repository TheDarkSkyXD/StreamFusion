import { useTranslation } from "react-i18next";
import type React from "react";
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Emote, EmoteProvider } from "../../../../../../backend/services/emotes/emote-types";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import { getEmoteViewerScopeKey, useEmoteStore } from "../../../../../store/emote-store";
import { EmoteImage } from "../EmoteImage";

const MAX_QUICK_EMOTES = 9;
const EMPTY_RECENT_EMOTES: Emote[] = [];
const QUICK_EMOTE_PROVIDERS: Record<ChatPlatform, EmoteProvider[]> = {
  kick: ["kick", "7tv"],
  twitch: ["twitch", "7tv", "bttv", "ffz"],
};

function getEmoteKey(emote: Emote): string {
  return `${emote.provider}:${emote.id}`;
}

function isGlobalQuickEmote(emote: Emote): boolean {
  return emote.isGlobal || emote.availability === "global" || emote.kickSection === "global";
}

interface QuickEmoteActionBarProps {
  platform: ChatPlatform;
  viewerUserId?: string;
  onSelect: (emote: Emote) => void;
  disabled?: boolean;
}

export const QuickEmoteActionBar: React.FC<QuickEmoteActionBarProps> = memo(
  ({ platform, viewerUserId, onSelect, disabled = false }) => {
    const { t } = useTranslation();
    const viewerScopeKey = getEmoteViewerScopeKey({
      platform,
      userId: viewerUserId ?? null,
    });
    const { recentEmotes, activeChannelId, loadedChannels, loadedGlobalPlatforms, emoteRevision } =
      useEmoteStore(
        useShallow((state) => ({
          recentEmotes: state.recentEmotesByScope[viewerScopeKey] ?? EMPTY_RECENT_EMOTES,
          activeChannelId: state.activeChannelId,
          loadedChannels: state.loadedChannels,
          loadedGlobalPlatforms: state.loadedGlobalPlatforms,
          emoteRevision: state.emoteRevision,
        }))
      );
    const getEmotesByProvider = useEmoteStore((state) => state.getEmotesByProvider);
    const itemRefs = useRef(new Map<string, HTMLButtonElement>());
    const previousRectsRef = useRef(new Map<string, DOMRect>());

    // Touch these store fields so Zustand re-renders this lightweight row when
    // manager-backed emote data changes, then recompute from the manager below.
    void activeChannelId;
    void loadedChannels;
    void loadedGlobalPlatforms;
    void emoteRevision;

    const quickEmotes = (() => {
      const providers = QUICK_EMOTE_PROVIDERS[platform];
      const providerSet = new Set(providers);
      const seen = new Set<string>();
      const result: Emote[] = [];

      for (const emote of recentEmotes) {
        if (!providerSet.has(emote.provider)) continue;
        const key = getEmoteKey(emote);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(emote);
        if (result.length >= MAX_QUICK_EMOTES) return result;
      }

      const emotesByProvider = getEmotesByProvider();
      for (const provider of providers) {
        const emotes = emotesByProvider.get(provider) ?? [];
        for (const emote of emotes) {
          if (!isGlobalQuickEmote(emote)) continue;
          const key = getEmoteKey(emote);
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(emote);
          if (result.length >= MAX_QUICK_EMOTES) return result;
        }
      }

      return result;
    })();

    const setItemRef = useCallback(
      (key: string) => (node: HTMLButtonElement | null) => {
        if (node) {
          itemRefs.current.set(key, node);
        } else {
          itemRefs.current.delete(key);
        }
      },
      []
    );

    useLayoutEffect(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const nextRects = new Map<string, DOMRect>();

      for (const emote of quickEmotes) {
        const key = getEmoteKey(emote);
        const node = itemRefs.current.get(key);
        if (!node) continue;

        const rect = node.getBoundingClientRect();
        const previousRect = previousRectsRef.current.get(key);
        nextRects.set(key, rect);

        if (reduceMotion || !previousRect) continue;

        const deltaX = previousRect.left - rect.left;
        const deltaY = previousRect.top - rect.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

        node.animate(
          [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }],
          {
            duration: 180,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
          }
        );
      }

      previousRectsRef.current = nextRects;
    }, [quickEmotes]);

    if (quickEmotes.length === 0) return null;

    return (
      <div
        data-testid="quick-emote-action-bar"
        className="flex h-8 min-h-8 items-center gap-2 overflow-hidden px-1"
        aria-label={t("chat.quickEmotes")}
      >
        {quickEmotes.map((emote, index) => {
          const key = getEmoteKey(emote);
          return (
            <button
              key={key}
              ref={setItemRef(key)}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(emote)}
              aria-label={t("chat.useValue0", { value0: emote.name })}
              data-testid="quick-emote-button"
              data-emote-key={key}
              className="group flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-white/10 bg-[#252525] p-0.5 opacity-90 transition-[background-color,border-color,opacity,transform] duration-150 ease-out hover:border-white/20 hover:bg-[#2d2d2d] hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#191919] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ animationDelay: `${Math.min(index, 8) * 12}ms` }}
            >
              <EmoteImage
                emote={emote}
                size="quick"
                lazyLoad={false}
                showTooltip={true}
                className="max-w-full transition-transform duration-150 ease-out group-hover:scale-110"
              />
            </button>
          );
        })}
      </div>
    );
  }
);

QuickEmoteActionBar.displayName = "QuickEmoteActionBar";
