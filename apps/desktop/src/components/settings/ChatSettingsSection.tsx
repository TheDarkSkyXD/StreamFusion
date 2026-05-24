import { type ReactNode, useCallback, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_CHAT_PREFERENCES,
} from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

/**
 * Chat settings, grouped. Backs the Settings → Chat tab (U6) and is reused by
 * the in-chat quick-settings gear (U7), which renders a subset via `only` and
 * the small exported row primitives + `useChatDisplay` writer.
 *
 * Reads the global `chatDisplay` preference group and writes back through
 * `updatePreferences` with the spread-existing idiom (sibling fields intact).
 * Each group card carries its OWN transient "Saved" indicator — a single
 * page-level bool races across ~20 controls.
 */

export type ChatSettingsGroup = "appearance" | "emotes" | "events" | "behavior";

const SAVED_MS = 2000;

// ───────────────────────────── shared writer hook ─────────────────────────────

/**
 * Resolves the current `chatDisplay` group (falling back to defaults) and
 * returns a `set` writer that persists a single-field patch with the spread
 * preserved. The optional `onSaved` fires after a successful write so a group
 * card (or the gear) can flash its own "Saved" indicator.
 */
export function useChatDisplay(onSaved?: () => void) {
  const cd = useAuthStore((s) => s.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
  const updatePreferences = useAuthStore((s) => s.updatePreferences);
  // Read full prefs lazily inside the writer so the freshest sibling groups are
  // spread (avoids stomping a concurrent write to another group).

  const set = useCallback(
    async <K extends keyof ChatDisplayPreferences>(field: K, value: ChatDisplayPreferences[K]) => {
      const current =
        useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
      await updatePreferences({ chatDisplay: { ...current, [field]: value } });
      onSaved?.();
    },
    [updatePreferences, onSaved]
  );

  return { cd, set };
}

/** Local transient "Saved" flag — one per group card. */
function useSavedFlag(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaved(true);
    timer.current = setTimeout(() => setSaved(false), SAVED_MS);
  }, []);
  return [saved, flash];
}

// ───────────────────────────── row primitives ─────────────────────────────
// Exported so U7's gear can compose its own subset without inheriting the
// group/card chrome.

export function SavedTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="text-xs text-yellow-500 font-medium animate-in fade-in slide-in-from-right-2 duration-300">
      Saved
    </span>
  );
}

export function SettingRow({
  label,
  description,
  note,
  control,
}: {
  label: string;
  description?: ReactNode;
  note?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-200 truncate">{label}</p>
        {description && <p className="text-sm text-zinc-500 mt-0.5">{description}</p>}
        {note && <p className="text-xs text-zinc-600 mt-1 italic">{note}</p>}
      </div>
      <div className="flex-shrink-0 flex items-center">{control}</div>
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  note,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  note?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      note={note}
      control={<Switch checked={checked} onCheckedChange={onChange} />}
    />
  );
}

export function RangeRow({
  label,
  description,
  note,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  note?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (next: number) => void;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      note={note}
      control={
        <div className="flex items-center gap-3 w-[180px]">
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 min-w-0 h-1.5 cursor-pointer appearance-none rounded-full bg-[#27272a] accent-[#dc143c]"
          />
          <span className="flex-shrink-0 w-12 text-right text-sm tabular-nums text-zinc-300">
            {value}
            {unit ? unit : ""}
          </span>
        </div>
      }
    />
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
          <SelectTrigger className="w-[160px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-yellow-500/20">
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

function GroupCard({
  title,
  saved,
  children,
}: {
  title: string;
  saved: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{title}</h3>
        <SavedTag show={saved} />
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
  const [saved, flash] = useSavedFlag();
  const { cd, set } = useChatDisplay(flash);
  return (
    <GroupCard title="Appearance" saved={saved}>
      <SwitchRow
        label="Bold usernames"
        checked={cd.boldUsernames}
        onChange={(v) => set("boldUsernames", v)}
      />
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
      <RangeRow
        label="Docked chat width"
        description="Width of the chat panel as a percentage of the stream area."
        value={cd.chatWidthPct}
        min={10}
        max={60}
        unit="%"
        onChange={(v) => set("chatWidthPct", v)}
      />
    </GroupCard>
  );
}

function EmotesGroup() {
  const [saved, flash] = useSavedFlag();
  const { cd, set } = useChatDisplay(flash);
  const nextLoadNote = "Applies on next channel load.";
  return (
    <GroupCard title="Emotes & badges" saved={saved}>
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

function EventsGroup() {
  const [saved, flash] = useSavedFlag();
  const { cd, set } = useChatDisplay(flash);
  return (
    <GroupCard title="Messages & events" saved={saved}>
      <RangeRow
        label="Message limit"
        description="Messages kept in the buffer before the oldest are removed."
        note="Higher values use more memory."
        value={cd.messageLimit}
        min={10}
        max={400}
        step={10}
        onChange={(v) => set("messageLimit", v)}
      />
      <SwitchRow
        label="Load recent messages on join"
        checked={cd.recentMessagesOnJoin}
        onChange={(v) => set("recentMessagesOnJoin", v)}
      />
      {cd.recentMessagesOnJoin && (
        <RangeRow
          label="Recent messages to load"
          value={cd.recentMessagesLimit}
          min={1}
          max={200}
          onChange={(v) => set("recentMessagesLimit", v)}
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
  const [saved, flash] = useSavedFlag();
  const updatePreferences = useAuthStore((s) => s.updatePreferences);
  const hidden = useAuthStore((s) => s.preferences?.chat?.position) === "hidden";

  const onHideChange = async (next: boolean) => {
    const current = useAuthStore.getState().preferences?.chat ?? DEFAULT_CHAT_PREFERENCES;
    await updatePreferences({ chat: { ...current, position: next ? "hidden" : "right" } });
    flash();
  };

  return (
    <GroupCard title="Behavior" saved={saved}>
      <SwitchRow
        label="Hide chat panel"
        description="Collapse the docked chat panel on stream pages."
        checked={hidden}
        onChange={onHideChange}
      />
    </GroupCard>
  );
}
