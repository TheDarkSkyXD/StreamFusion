import { type ReactNode, useCallback, useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { notifySettingsSaved } from "@/lib/settings-toast";
import { cn } from "@/lib/utils";
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_CHAT_PREFERENCES,
  type DeletedMessageDisplayMode,
  type ModerationHighlightStyle,
} from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

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

// ───────────────────────────── shared writer hook ─────────────────────────────

/**
 * Resolves the current `chatDisplay` group (falling back to defaults) and
 * returns a `set` writer that persists a single-field patch with the spread
 * preserved. The optional `onSaved` fires after a successful write (the
 * Settings groups pass `notifySettingsSaved`; the in-chat gear omits it).
 */
export function useChatDisplay(onSaved?: () => void) {
  const storedChatDisplay = useAuthStore((s) => s.preferences?.chatDisplay);
  const cd = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...(storedChatDisplay ?? {}) };
  const updatePreferences = useAuthStore((s) => s.updatePreferences);
  // Read full prefs lazily inside the writer so the freshest sibling groups are
  // spread (avoids stomping a concurrent write to another group).

  const set = useCallback(
    async <K extends keyof ChatDisplayPreferences>(field: K, value: ChatDisplayPreferences[K]) => {
      const current =
        useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
      await updatePreferences({
        chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...current, [field]: value },
      });
      onSaved?.();
    },
    [updatePreferences, onSaved]
  );

  return { cd, set };
}

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
                <p className="text-xs text-zinc-600">Default: {defaultDisplayValue}</p>
              )}
              {onReset && (
                <button
                  type="button"
                  aria-label={`Reset ${label} to default`}
                  disabled={!canReset}
                  onClick={() => {
                    if (defaultValue !== undefined) {
                      setDraftValue(defaultValue);
                    }
                    onReset();
                  }}
                  className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-[#27272a] hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121214] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                >
                  Reset
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

export function SelectRow<T extends string>({
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

// ───────────────────────────── the section ─────────────────────────────

export function ChatSettingsSection({
  only,
  className,
}: {
  /** Render only these groups (used by the in-chat gear for a subset). */
  only?: ChatSettingsGroup[];
  className?: string;
}) {
  const show = (g: ChatSettingsGroup) => !only || only.includes(g);

  return (
    <div className={cn("space-y-6", className)}>
      {show("appearance") && <AppearanceGroup />}
      {show("emotes") && <EmotesGroup />}
      {show("events") && <EventsGroup />}
      {show("behavior") && <BehaviorGroup />}
    </div>
  );
}

function AppearanceGroup() {
  const { cd, set } = useChatDisplay(notifySettingsSaved);
  return (
    <GroupCard title="Appearance">
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
          { value: "HH:mm", label: "24-hour" },
          { value: "h:mm a", label: "12-hour" },
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
          { value: "cozy", label: "Cozy" },
          { value: "compact", label: "Compact" },
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
    <GroupCard title="Emotes & badges">
      <div className="py-3 text-xs text-zinc-600 leading-relaxed">
        Third-party emotes currently affect the emote picker. In-message rendering is upcoming.
      </div>
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
            Selected
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
            <span>Timeout</span>
          </span>
        )}
        <span className={cn("block bg-[#1f1f24] px-1.5 py-1", isCozy && "bg-[#18181b]")}>
          <span className="font-bold text-[#70AD47]">Mod</span>
          <span className="text-[#adadb8]"> removed </span>
          <span className="text-white">message</span>
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
    <GroupCard title="Messages & events">
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
          { value: "tombstone", label: "Tombstone only" },
          { value: "message", label: "Message content only" },
          { value: "compact", label: "Full compact detail (Recommended)" },
          { value: "audit", label: "Audit-style detail" },
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
    <GroupCard title="Behavior">
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
