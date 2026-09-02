import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Emote } from "@backend/services/emotes/emote-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatChatTimestamp,
  getSevenTvPaintStyle,
  resolveChatUsernameColor,
} from "@/features/chat/utils/chat-visuals";
import { getChatDensityPresentation } from "@/features/chat/utils/chat-density-presentation";
import { notifySettingsSaved } from "@/features/settings/utils/settings-toast";
import { translateSettings } from "@/features/settings/utils/settings-translation";
import { useChatDisplay } from "@/features/settings/data/use-chat-display";
import { cn } from "@/lib/utils";
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_CHAT_PREFERENCES,
  type DeletedMessageDisplayMode,
  type ModerationHighlightStyle,
} from "@shared/auth-types";
import type { SevenTvPaint } from "@shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { useChatCosmeticsStore } from "@/store/chat-cosmetics-store";
import { useEmoteStore } from "@/store/emote-store";
import {
  CHAT_PREVIEW_FALLBACK_EMOTES,
  CHAT_PREVIEW_OVERLAY_EMOTE_URL,
  getChatPreviewFallbackBadges,
} from "./chat-settings-preview-assets";

/**
 * Chat settings, grouped. Backs the Settings → Chat tab (U6) and is reused by
 * the in-chat quick-settings gear (U7), which renders a subset via `only` and
 * the small exported row primitives + `useChatDisplay` writer.
 *
 * Reads the global `chatDisplay` preference group and writes back through
 * `updatePreferences` with the spread-existing idiom (sibling fields intact).
 * Saves auto-fire on change and surface a single unified "Saved" toast (see
 * `notifySettingsSaved`), shared with the rest of the Settings page.
 */

export type ChatSettingsGroup = "appearance" | "emotes" | "events" | "behavior";

// ───────────────────────────── row primitives ─────────────────────────────
// Exported so U7's gear can compose its own subset without inheriting the
// group/card chrome.

export function SettingRow({
  label,
  description,
  note,
  control,
  icon,
}: {
  label: string;
  description?: ReactNode;
  note?: ReactNode;
  control: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1 flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex-shrink-0 text-zinc-500" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-200 break-words">{label}</p>
          {description && <p className="text-sm text-zinc-500 mt-0.5">{description}</p>}
          {note && <p className="text-xs text-zinc-600 mt-1 italic">{note}</p>}
        </div>
      </div>
      <div className="flex-shrink-0 flex items-center min-h-[1.5rem]">{control}</div>
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  note,
  checked,
  onChange,
  icon,
}: {
  label: string;
  description?: ReactNode;
  note?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      note={note}
      icon={icon}
      control={<Switch checked={checked} onCheckedChange={onChange} />}
    />
  );
}

export function RangeRow({
  label,
  description,
  note,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  unit,
  onChange,
  onReset,
  icon,
}: {
  label: string;
  description?: ReactNode;
  note?: ReactNode;
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (next: number) => void;
  onReset?: () => void;
  icon?: ReactNode;
}) {
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const formatValue = (nextValue: number) => `${nextValue}${unit ? unit : ""}`;
  const clampedValue = Math.min(max, Math.max(min, draftValue));
  const steppedValue =
    step > 0
      ? Math.min(max, Math.max(min, min + Math.round((clampedValue - min) / step) * step))
      : clampedValue;
  const formattedValue = formatValue(steppedValue);
  const defaultDisplayValue = defaultValue === undefined ? undefined : formatValue(defaultValue);
  const canReset = defaultValue !== undefined && steppedValue !== defaultValue;
  const range = max - min;
  const filledPercent =
    range > 0 ? Math.min(100, Math.max(0, ((steppedValue - min) / range) * 100)) : 0;
  const intervalCount = step > 0 ? Math.round((max - min) / step) : 0;
  const tickStepIndexes =
    intervalCount >= 2
      ? intervalCount <= 40
        ? Array.from({ length: intervalCount + 1 }, (_, index) => index)
        : Array.from({ length: 11 }, (_, index) => Math.round((index / 10) * intervalCount))
      : [];
  const ticks = [...new Set(tickStepIndexes)].map((index) => {
    const tickValue = min + index * step;
    const tickPercent =
      range > 0 ? Math.min(100, Math.max(0, ((tickValue - min) / range) * 100)) : 0;

    return { percent: tickPercent, value: tickValue };
  });

  return (
    <div className="py-3">
      <div className="min-w-0 flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex-shrink-0 text-zinc-500" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <p className="min-w-0 flex-1 font-medium text-zinc-200 break-words">{label}</p>
            <span className="flex-shrink-0 text-right text-sm tabular-nums text-zinc-300">
              {formattedValue}
            </span>
          </div>
          <div className="relative mt-2 h-5">
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-[#27272a]">
              <div
                className="h-full rounded-full bg-zinc-200"
                style={{ width: `${filledPercent}%` }}
              />
            </div>
            <input
              type="range"
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={steppedValue}
              onChange={(e) => {
                const nextValue = Number(e.target.value);
                setDraftValue(nextValue);
                onChange(nextValue);
              }}
              className={cn(
                "absolute inset-0 z-30 block h-full w-full cursor-pointer appearance-none bg-transparent",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121214]",
                "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-runnable-track]:bg-transparent",
                "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
                "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-zinc-300 [&::-webkit-slider-thumb]:bg-zinc-100",
                "[&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:hover:bg-white",
                "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:bg-transparent",
                "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border",
                "[&::-moz-range-thumb]:border-zinc-300 [&::-moz-range-thumb]:bg-zinc-100 [&::-moz-range-thumb]:transition-colors [&::-moz-range-thumb]:hover:bg-white"
              )}
            />
            {ticks.length > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2"
                aria-hidden
              >
                {ticks.map((tick) => (
                  <span
                    key={tick.value}
                    data-slider-tick=""
                    data-slider-tick-value={tick.value}
                    data-slider-tick-percent={tick.percent}
                    data-slider-tick-active={tick.percent <= filledPercent}
                    style={{ left: `${tick.percent}%` }}
                    className={cn(
                      "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-[#121214]",
                      tick.percent <= filledPercent ? "bg-[#121214] ring-zinc-200" : "bg-zinc-500"
                    )}
                  />
                ))}
              </div>
            )}
          </div>
          {description && <p className="text-sm text-zinc-500 mt-1.5">{description}</p>}
          {(defaultDisplayValue || onReset) && (
            <div className="mt-1.5 flex min-h-6 items-center justify-between gap-3">
              {defaultDisplayValue && (
                <p className="text-xs text-zinc-600">
                  {translateSettings("settings.defaultValue", { value: defaultDisplayValue })}
                </p>
              )}
              {onReset && (
                <button
                  type="button"
                  aria-label={translateSettings("settings.resetValueToDefault", { label: label })}
                  disabled={!canReset}
                  onClick={() => {
                    if (defaultValue !== undefined) {
                      setDraftValue(defaultValue);
                    }
                    onReset();
                  }}
                  className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-[#27272a] hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121214] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                >
                  {translateSettings("settings.reset")}
                </button>
              )}
            </div>
          )}
          {note && <p className="text-xs text-zinc-600 mt-1 italic">{note}</p>}
        </div>
      </div>
    </div>
  );
}

function SelectRow<T extends string>({
  label,
  description,
  note,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  note?: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      note={note}
      control={
        <Select value={value} onValueChange={(v) => onChange(v as T)}>
          <SelectTrigger
            aria-label={label}
            className="w-[160px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-yellow-500/20"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

// ───────────────────────────── group card ─────────────────────────────

function GroupCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{title}</h3>
      </div>
      <div className="px-6 py-2 divide-y divide-[#27272a]/60">{children}</div>
    </div>
  );
}

const SAMPLE_CHAT_TIME = new Date(2026, 0, 1, 21, 5, 7);
const SAMPLE_PAINT = {
  id: "settings-preview-paint",
  name: "Settings preview",
  function: "linear-gradient",
  angle: 120,
  repeat: false,
  stops: [
    { at: 0, color: "rgba(169, 112, 255, 1)" },
    { at: 0.52, color: "rgba(255, 255, 255, 1)" },
    { at: 1, color: "rgba(83, 252, 24, 1)" },
  ],
  shadows: [{ xOffset: 0, yOffset: 1, radius: 3, color: "rgba(169, 112, 255, 0.45)" }],
} satisfies SevenTvPaint;

function PreviewFrame({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="py-4" data-testid={testId}>
      <div className="overflow-hidden rounded-lg border border-[#333333] bg-[#18181b]">
        <div className="border-b border-[#333333] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          {translateSettings("settings.preview")}
        </div>
        {children}
      </div>
    </div>
  );
}

function PreviewTooltip({
  label,
  content,
  children,
  className,
}: {
  label: string;
  content: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={label}
          data-preview-tooltip-trigger=""
          className={cn(
            "inline-flex border-0 bg-transparent p-0 text-inherit outline-none focus-visible:ring-1 focus-visible:ring-white",
            className
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs font-medium">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function SampleEmote({
  animated = false,
  emote,
  overlay = false,
  provider,
  size,
}: {
  animated?: boolean;
  emote: Emote;
  overlay?: boolean;
  provider?: "7tv" | "bttv" | "ffz";
  size: number;
}) {
  return (
    <span
      className="relative inline-flex shrink-0 align-middle"
      data-preview-provider={provider}
      style={{ width: size, height: size }}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn(
          "absolute inset-0 size-full object-contain",
          animated && "motion-safe:animate-pulse"
        )}
        decoding="async"
        draggable={false}
        loading="eager"
        src={emote.urls.url2x}
      />
      {overlay && (
        <PreviewTooltip
          label="Overlay emote preview"
          content="This stacked emote is controlled by the Overlay emotes setting."
          className="absolute inset-0 size-full rounded-[4px]"
        >
          <img
            alt=""
            aria-hidden="true"
            className="size-full object-contain"
            decoding="async"
            draggable={false}
            src={CHAT_PREVIEW_OVERLAY_EMOTE_URL}
          />
        </PreviewTooltip>
      )}
    </span>
  );
}

function AppearancePreview({ cd }: { cd: ChatDisplayPreferences }) {
  const densityPresentation = getChatDensityPresentation(cd.density);
  const uncoloredUsernameColor = resolveChatUsernameColor({
    platform: "twitch",
    readableColorForUncolored: cd.readableColorForUncolored,
    themeAdaptUsernameColor: cd.themeAdaptUsernameColor,
    username: "NightOwl",
  });
  const chosenUsernameColor = resolveChatUsernameColor({
    color: "#35214a",
    platform: "twitch",
    readableColorForUncolored: cd.readableColorForUncolored,
    themeAdaptUsernameColor: cd.themeAdaptUsernameColor,
    username: "DeepViolet",
  });

  return (
    <PreviewFrame testId="appearance-chat-preview">
      <div
        className="px-3 text-zinc-200"
        data-density={cd.density}
        style={{ fontSize: `${cd.fontSizePx}px`, lineHeight: 1.35 }}
      >
        <div className={cn("flex items-center gap-1.5", densityPresentation.rowPaddingClass)}>
          {cd.timestamps && (
            <span className="shrink-0 text-[0.75em] tabular-nums text-zinc-500">
              {formatChatTimestamp(SAMPLE_CHAT_TIME, cd.timestampFormat)}
            </span>
          )}
          <span className="font-bold" style={{ color: uncoloredUsernameColor }}>
            {translateSettings("settings.nightowl")}
          </span>
          <span className="min-w-0 truncate">
            {translateSettings("settings.thisChatSetupFeelsRight")}
          </span>
          <SampleEmote emote={CHAT_PREVIEW_FALLBACK_EMOTES["7tv"]} size={cd.emoteSizePx} />
        </div>
        <div className={cn("flex items-center gap-1.5", densityPresentation.rowPaddingClass)}>
          <span
            className="font-bold"
            data-preview-adapted-color="true"
            style={{ color: chosenUsernameColor }}
          >
            {translateSettings("settings.deepviolet")}
          </span>
          <span className="min-w-0 truncate text-zinc-400">
            {translateSettings("settings.lowContrastColorsStayReadable")}
          </span>
        </div>
      </div>
    </PreviewFrame>
  );
}

function EmotesPreview({ cd }: { cd: ChatDisplayPreferences }) {
  const { i18n: translation } = useTranslation();
  const translationLanguage = translation.resolvedLanguage ?? translation.language;
  useEmoteStore((state) => state.emoteRevision);
  useEmoteStore((state) => state.activeChannelId);
  const badgeDefinitions = useChatCosmeticsStore((state) => state.badgeDefinitions);
  const loadedEmotes = useEmoteStore.getState().getEmotesByProvider();
  const providerEmotes = {
    "7tv": loadedEmotes.get("7tv")?.[0] ?? CHAT_PREVIEW_FALLBACK_EMOTES["7tv"],
    bttv: loadedEmotes.get("bttv")?.[0] ?? CHAT_PREVIEW_FALLBACK_EMOTES.bttv,
    ffz: loadedEmotes.get("ffz")?.[0] ?? CHAT_PREVIEW_FALLBACK_EMOTES.ffz,
  };
  const providerBadges = useMemo(() => {
    const loaded = [...badgeDefinitions.values()];
    const fallbackBadges = getChatPreviewFallbackBadges(translationLanguage);
    return {
      "7tv": loaded.find((badge) => badge.provider === "7tv") ?? fallbackBadges["7tv"],
      bttv: loaded.find((badge) => badge.provider === "bttv") ?? fallbackBadges.bttv,
      ffz: loaded.find((badge) => badge.provider === "ffz") ?? fallbackBadges.ffz,
    };
  }, [badgeDefinitions, translationLanguage]);
  const fallbackColor = resolveChatUsernameColor({
    color: "#9146ff",
    platform: "twitch",
    readableColorForUncolored: cd.readableColorForUncolored,
    themeAdaptUsernameColor: cd.themeAdaptUsernameColor,
    username: "PaintedPixel",
  });
  const usernameStyle = cd.enable7tvUsernamePaints
    ? (getSevenTvPaintStyle(SAMPLE_PAINT, fallbackColor) ?? { color: fallbackColor })
    : { color: fallbackColor };

  return (
    <PreviewFrame testId="emotes-chat-preview">
      <div className="space-y-2 px-3 py-3 text-sm text-zinc-200">
        <div className="flex items-center gap-1.5">
          {cd.enable7tvBadges && (
            <PreviewTooltip
              label="7TV badge preview"
              content="7TV badge. Controlled by the 7TV chat badges setting."
              className="size-4 rounded-[3px]"
            >
              <span className="inline-flex size-4" data-preview-badge-provider="7tv">
                <img
                  alt=""
                  className="size-4 object-contain"
                  src={providerBadges["7tv"].imageUrl}
                />
              </span>
            </PreviewTooltip>
          )}
          {cd.enableBttvBadges && (
            <PreviewTooltip
              label="BetterTTV badge preview"
              content="BetterTTV badge. Controlled by the BetterTTV chat badges setting."
              className="size-4 rounded-[3px]"
            >
              <span className="inline-flex size-4" data-preview-badge-provider="bttv">
                <img alt="" className="size-4 object-contain" src={providerBadges.bttv.imageUrl} />
              </span>
            </PreviewTooltip>
          )}
          {cd.enableFfzBadges && (
            <PreviewTooltip
              label="FrankerFaceZ badge preview"
              content="FrankerFaceZ badge. Controlled by the FrankerFaceZ chat badges setting."
              className="size-4 rounded-[3px]"
            >
              <span className="inline-flex size-4" data-preview-badge-provider="ffz">
                <img alt="" className="size-4 object-contain" src={providerBadges.ffz.imageUrl} />
              </span>
            </PreviewTooltip>
          )}
          {cd.enable7tvUsernamePaints ? (
            <PreviewTooltip
              label="7TV username paint preview"
              content="7TV username paint. Controlled by the 7TV username paints setting."
              className="rounded-[3px] font-bold"
            >
              <span data-preview-painted="true" style={usernameStyle}>
                {translateSettings("settings.paintedpixel")}
              </span>
            </PreviewTooltip>
          ) : (
            <span className="font-bold" data-preview-painted="false" style={usernameStyle}>
              {translateSettings("settings.paintedpixel")}
            </span>
          )}
          <span className="text-zinc-400">{translateSettings("settings.greatStream")}</span>
          {cd.enable7tv && (
            <SampleEmote
              animated={cd.animatedEmotes}
              emote={providerEmotes["7tv"]}
              overlay={cd.overlayEmotes}
              provider="7tv"
              size={cd.emoteSizePx}
            />
          )}
          {cd.enableBttv && (
            <SampleEmote
              animated={cd.animatedEmotes}
              emote={providerEmotes.bttv}
              overlay={cd.overlayEmotes}
              provider="bttv"
              size={cd.emoteSizePx}
            />
          )}
          {cd.enableFfz && (
            <SampleEmote
              animated={cd.animatedEmotes}
              emote={providerEmotes.ffz}
              overlay={cd.overlayEmotes}
              provider="ffz"
              size={cd.emoteSizePx}
            />
          )}
        </div>
        {cd.systemMessageEmotes && (
          <div className="flex items-center gap-1.5 rounded-md bg-[#202024] px-2 py-1 text-xs text-zinc-400">
            <SampleEmote emote={providerEmotes["7tv"]} size={18} />
            <span>{translateSettings("settings.systemEmotesAreEnabled")}</span>
          </div>
        )}
      </div>
    </PreviewFrame>
  );
}

function EventsPreview({ cd }: { cd: ChatDisplayPreferences }) {
  return (
    <PreviewFrame testId="events-chat-preview">
      <div className="space-y-1.5 px-3 py-3 text-xs text-zinc-300">
        {cd.showUserNotices && (
          <div className="rounded-md bg-[#252525] px-2 py-1.5">
            <span className="font-semibold text-white">
              {translateSettings("settings.nightowl2")}
            </span>{" "}
            {translateSettings("settings.subscribedFor6Months")}
          </div>
        )}
        {cd.showClearMsg && (
          <PreviewTooltip
            label="Deleted message preview"
            content="Controlled by Deleted message display and Moderation highlight style."
            className={cn(
              "w-full px-2 py-1.5 text-left",
              cd.moderationHighlightStyle === "cozy"
                ? "rounded-md border border-[#f87171]/60 bg-[#211b1d]"
                : "border-l border-[#f87171] bg-[#202024]"
            )}
          >
            <span data-deleted-mode={cd.deletedMessageDisplay}>
              {cd.deletedMessageDisplay === "tombstone"
                ? translateSettings("settings.messageDeleted")
                : translateSettings("settings.modRemovedKeepChatFriendly")}
            </span>
          </PreviewTooltip>
        )}
        {cd.showClearChat && (
          <div className="text-zinc-500">
            {translateSettings("settings.chatWasClearedByAModerator")}
          </div>
        )}
        {cd.firstMsgHighlight && (
          <div className="rounded-md border border-[#a970ff]/50 px-2 py-1 text-[#d8bfff]">
            {translateSettings("settings.firstMessageFromANewChatter")}
          </div>
        )}
        <div className="flex gap-1.5">
          {cd.showPolls && (
            <span className="rounded bg-[#2d2d32] px-2 py-1">
              {translateSettings("settings.pollOpen")}
            </span>
          )}
          {cd.showPredictions && (
            <span className="rounded bg-[#2d2d32] px-2 py-1">
              {translateSettings("settings.predictionLive")}
            </span>
          )}
        </div>
      </div>
    </PreviewFrame>
  );
}

// ───────────────────────────── the section ─────────────────────────────

export function ChatSettingsSection({
  only,
  className,
}: {
  /** Render only these groups (used by the in-chat gear for a subset). */
  only?: ChatSettingsGroup[];
  className?: string;
}) {
  useTranslation();
  const show = (g: ChatSettingsGroup) => !only || only.includes(g);

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("space-y-6", className)}>
        {show("appearance") && <AppearanceGroup />}
        {show("emotes") && <EmotesGroup />}
        {show("events") && <EventsGroup />}
        {show("behavior") && <BehaviorGroup />}
      </div>
    </TooltipProvider>
  );
}

function AppearanceGroup() {
  const { cd, set } = useChatDisplay(notifySettingsSaved);
  return (
    <GroupCard title={translateSettings("settings.appearance")}>
      <AppearancePreview cd={cd} />
      <SwitchRow
        label="Readable color for uncolored users"
        description="Assign a deterministic readable color to chatters with no chosen color."
        checked={cd.readableColorForUncolored}
        onChange={(v) => set("readableColorForUncolored", v)}
      />
      <SwitchRow
        label="Adapt username colors to dark theme"
        description="Lift low-contrast username colors so they stay legible."
        checked={cd.themeAdaptUsernameColor}
        onChange={(v) => set("themeAdaptUsernameColor", v)}
      />
      <SwitchRow
        label="Show timestamps"
        checked={cd.timestamps}
        onChange={(v) => set("timestamps", v)}
      />
      <SelectRow
        label="Timestamp format"
        value={cd.timestampFormat}
        options={[
          { value: "H:mm", label: translateSettings("settings.value24Hour905") },
          { value: "HH:mm", label: translateSettings("settings.value24Hour0905") },
          { value: "H:mm:ss", label: translateSettings("settings.value24Hour90507") },
          { value: "HH:mm:ss", label: translateSettings("settings.value24Hour090507") },
          { value: "h:mm a", label: translateSettings("settings.value12Hour905Am") },
          { value: "hh:mm a", label: translateSettings("settings.value12Hour0905Am") },
          { value: "h:mm:ss a", label: translateSettings("settings.value12Hour90507Am") },
          { value: "hh:mm:ss a", label: translateSettings("settings.value12Hour090507Am") },
        ]}
        onChange={(v) => set("timestampFormat", v)}
      />
      <RangeRow
        label="Font size"
        value={cd.fontSizePx}
        min={10}
        max={20}
        unit="px"
        onChange={(v) => set("fontSizePx", v)}
      />
      <RangeRow
        label="Emote size"
        value={cd.emoteSizePx}
        min={16}
        max={56}
        unit="px"
        onChange={(v) => set("emoteSizePx", v)}
      />
      <SelectRow
        label="Density"
        value={cd.density}
        options={[
          { value: "compact", label: translateSettings("settings.tight") },
          { value: "cozy", label: translateSettings("settings.medium") },
          { value: "loose", label: translateSettings("settings.loose") },
        ]}
        onChange={(v) => set("density", v)}
      />
    </GroupCard>
  );
}

function EmotesGroup() {
  const { cd, set } = useChatDisplay(notifySettingsSaved);
  const nextLoadNote = "Applies on next channel load.";
  return (
    <GroupCard title={translateSettings("settings.emotesBadges")}>
      <EmotesPreview cd={cd} />
      <SwitchRow
        label="7TV emotes"
        note={nextLoadNote}
        checked={cd.enable7tv}
        onChange={(v) => set("enable7tv", v)}
      />
      <SwitchRow
        label="BetterTTV emotes"
        note={nextLoadNote}
        checked={cd.enableBttv}
        onChange={(v) => set("enableBttv", v)}
      />
      <SwitchRow
        label="FrankerFaceZ emotes"
        note={nextLoadNote}
        checked={cd.enableFfz}
        onChange={(v) => set("enableFfz", v)}
      />
      <SwitchRow
        label="7TV chat badges"
        description="Show 7TV profile badges next to Twitch usernames."
        checked={cd.enable7tvBadges}
        onChange={(v) => set("enable7tvBadges", v)}
      />
      <SwitchRow
        label="7TV username paints"
        description="Use 7TV gradients, image textures, and shadows on Twitch usernames."
        checked={cd.enable7tvUsernamePaints}
        onChange={(v) => set("enable7tvUsernamePaints", v)}
      />
      <SwitchRow
        label="BetterTTV chat badges"
        description="Show BetterTTV profile badges next to Twitch usernames."
        checked={cd.enableBttvBadges}
        onChange={(v) => set("enableBttvBadges", v)}
      />
      <SwitchRow
        label="FrankerFaceZ chat badges"
        description="Show FFZ global badges and channel-specific moderator or VIP artwork."
        checked={cd.enableFfzBadges}
        onChange={(v) => set("enableFfzBadges", v)}
      />
      <SwitchRow
        label="Animated emotes"
        description="Play animated emotes instead of a static frame."
        note={nextLoadNote}
        checked={cd.animatedEmotes}
        onChange={(v) => set("animatedEmotes", v)}
      />
      <SwitchRow
        label="Overlay emotes"
        description="Stack zero-width emotes on the previous emote."
        note={nextLoadNote}
        checked={cd.overlayEmotes}
        onChange={(v) => set("overlayEmotes", v)}
      />
      <SwitchRow
        label="Emotes in system messages"
        checked={cd.systemMessageEmotes}
        onChange={(v) => set("systemMessageEmotes", v)}
      />
    </GroupCard>
  );
}

function HighlightStylePreview({
  active,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone: "compact" | "cozy";
}) {
  const isCozy = tone === "cozy";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "group relative w-[148px] rounded-[8px] border p-2 text-left transition-[background,border-color,box-shadow,color,transform] duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121214]",
        active
          ? "border-white bg-[#242428] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.82)]"
          : "border-[#333333] bg-[#18181b] text-zinc-300 hover:-translate-y-0.5 hover:border-[#a1a1aa] hover:bg-[#202024] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(161,161,170,0.34)]"
      )}
    >
      <span className="mb-2 flex min-h-4 items-center justify-between gap-2">
        <span className="block text-xs font-semibold">{label}</span>
        {active && (
          <span className="rounded-[4px] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-normal text-[#18181b]">
            {translateSettings("settings.selected")}
          </span>
        )}
      </span>
      <span
        className={cn(
          "block overflow-hidden border text-[10px] leading-tight transition-colors duration-150",
          isCozy
            ? active
              ? "rounded-[6px] border-[#ff9b9b]"
              : "rounded-[6px] border-[#f87171] group-hover:border-[#ff9b9b]"
            : active
              ? "border-white/70 border-l-[#ff9b9b]"
              : "border-[#333333] border-l-[#f87171] group-hover:border-[#52525b] group-hover:border-l-[#ff9b9b]"
        )}
      >
        {isCozy && (
          <span className="flex h-5 items-center gap-1 bg-[#26262c] px-1.5 text-[#efeff1]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
            <span>{translateSettings("settings.timeout")}</span>
          </span>
        )}
        <span className={cn("block bg-[#1f1f24] px-1.5 py-1", isCozy && "bg-[#18181b]")}>
          <span className="font-bold text-[#70AD47]">{translateSettings("settings.mod")}</span>
          <span className="text-[#adadb8]"> {translateSettings("settings.removed")}</span>
          <span className="text-white">{translateSettings("settings.message2")}</span>
        </span>
      </span>
    </button>
  );
}

function HighlightStyleRow({
  value,
  onChange,
}: {
  value: ModerationHighlightStyle;
  onChange: (value: ModerationHighlightStyle) => void;
}) {
  return (
    <SettingRow
      label="Moderation highlight style"
      description="Choose the visual treatment for deleted-message, timeout, and ban highlights."
      control={
        <div className="flex flex-wrap justify-end gap-2">
          <HighlightStylePreview
            active={value === "compact"}
            label="Compact"
            onClick={() => onChange("compact")}
            tone="compact"
          />
          <HighlightStylePreview
            active={value === "cozy"}
            label="Framed"
            onClick={() => onChange("cozy")}
            tone="cozy"
          />
        </div>
      }
    />
  );
}

function EventsGroup() {
  const { cd, set } = useChatDisplay(notifySettingsSaved);
  return (
    <GroupCard title={translateSettings("settings.messagesEvents")}>
      <EventsPreview cd={cd} />
      <RangeRow
        label="Message limit"
        description="Messages kept in the buffer before the oldest are removed."
        note="Higher values use more memory."
        value={cd.messageLimit}
        defaultValue={DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit}
        min={100}
        max={1000}
        step={100}
        onChange={(v) => set("messageLimit", v)}
        onReset={() => set("messageLimit", DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit)}
      />
      <SwitchRow
        label="Load recent messages on join"
        checked={cd.recentMessagesOnJoin}
        onChange={(v) => set("recentMessagesOnJoin", v)}
      />
      {cd.recentMessagesOnJoin && (
        <RangeRow
          label="Recent messages to load"
          value={Math.min(800, Math.max(100, cd.recentMessagesLimit))}
          defaultValue={DEFAULT_CHAT_DISPLAY_PREFERENCES.recentMessagesLimit}
          min={100}
          max={800}
          step={100}
          onChange={(v) => set("recentMessagesLimit", v)}
          onReset={() =>
            set("recentMessagesLimit", DEFAULT_CHAT_DISPLAY_PREFERENCES.recentMessagesLimit)
          }
        />
      )}
      <SwitchRow
        label="Show sub / raid notices"
        checked={cd.showUserNotices}
        onChange={(v) => set("showUserNotices", v)}
      />
      <SwitchRow
        label="Show deleted-message notices"
        checked={cd.showClearMsg}
        onChange={(v) => set("showClearMsg", v)}
      />
      <SelectRow<DeletedMessageDisplayMode>
        label="Deleted message display"
        description="Choose how much retained deleted-message detail appears in chat."
        value={cd.deletedMessageDisplay}
        options={[
          { value: "tombstone", label: translateSettings("settings.tombstoneOnly") },
          { value: "message", label: translateSettings("settings.messageContentOnly") },
          { value: "compact", label: translateSettings("settings.fullCompactDetailRecommended") },
          { value: "audit", label: translateSettings("settings.auditStyleDetail") },
        ]}
        onChange={(v) => set("deletedMessageDisplay", v)}
      />
      <HighlightStyleRow
        value={cd.moderationHighlightStyle}
        onChange={(v) => set("moderationHighlightStyle", v)}
      />
      <SwitchRow
        label="Show chat-cleared notices"
        checked={cd.showClearChat}
        onChange={(v) => set("showClearChat", v)}
      />
      <SwitchRow
        label="Highlight first-time chatters"
        checked={cd.firstMsgHighlight}
        onChange={(v) => set("firstMsgHighlight", v)}
      />
      <SwitchRow label="Show polls" checked={cd.showPolls} onChange={(v) => set("showPolls", v)} />
      <SwitchRow
        label="Show predictions"
        checked={cd.showPredictions}
        onChange={(v) => set("showPredictions", v)}
      />
    </GroupCard>
  );
}

function BehaviorGroup() {
  const { cd, set } = useChatDisplay(notifySettingsSaved);
  const updatePreferences = useAuthStore((s) => s.updatePreferences);
  const hidden = useAuthStore((s) => s.preferences?.chat?.position) === "hidden";

  const onHideChange = async (next: boolean) => {
    const current = useAuthStore.getState().preferences?.chat ?? DEFAULT_CHAT_PREFERENCES;
    await updatePreferences({ chat: { ...current, position: next ? "hidden" : "right" } });
    notifySettingsSaved();
  };

  return (
    <GroupCard title={translateSettings("settings.behavior")}>
      <SwitchRow
        label="Hide chat panel"
        description="Collapse the docked chat panel on stream pages."
        checked={hidden}
        onChange={onHideChange}
      />
      <SwitchRow
        label="Ask for Twitch pin duration"
        description="Show the duration dialog when pinning a Twitch chat message. Turn this off to pin immediately."
        checked={cd.showTwitchPinDurationDialog}
        onChange={(v) => set("showTwitchPinDurationDialog", v)}
      />
    </GroupCard>
  );
}
