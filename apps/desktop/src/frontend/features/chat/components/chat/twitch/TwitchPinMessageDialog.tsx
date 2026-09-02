import { i18n } from "@/i18n";
/**
 * TwitchPinMessageDialog
 *
 * Modal a mod uses to pick a duration before pinning a chat message.
 * Offers Helix-compatible timed choices, custom seconds/minutes, or no expiry.
 * Default = 30m (Twitch Helix's maximum timed pin duration).
 *
 * The actual pin mutation runs in the parent (`TwitchChat`) so the dialog
 * stays presentation-only — it just collects the duration and reports back
 * via `onConfirm(durationSeconds | null)`.
 */

import { useEffect, useState } from "react";
import { LuPin } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProxiedImage } from "@/components/ui/proxied-image";
import type { ChatMessage, ContentFragment } from "@shared/chat-types";
import { ChatEmote } from "../ChatEmote";
import { formatMentionLabel } from "../mention-label";

interface DurationOption {
  label: string;
  value: number | null;
}

const CUSTOM_DURATION = "custom";

type DurationSelection = DurationOption["value"] | typeof CUSTOM_DURATION;
type CustomDurationUnit = "seconds" | "minutes";

const DURATION_OPTIONS: DurationOption[] = [
  { label: i18n.t("chat.1Minute"), value: 60 },
  { label: i18n.t("chat.5Minutes"), value: 5 * 60 },
  { label: i18n.t("chat.15Minutes"), value: 15 * 60 },
  { label: i18n.t("chat.30Minutes"), value: 30 * 60 },
  { label: i18n.t("chat.noExpiry"), value: null },
];

const DEFAULT_DURATION_SECONDS = 30 * 60;
const avatarUrlByTwitchLogin = new Map<string, string>();

interface ChannelLookupResult {
  success: boolean;
  data?: {
    avatarUrl?: string;
  } | null;
}

function resolveDurationSelection(
  selection: DurationSelection,
  customAmount: string,
  customUnit: CustomDurationUnit
): number | null | undefined {
  if (selection !== CUSTOM_DURATION) return selection;
  const amount = Number(customAmount);
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  return customUnit === "minutes" ? amount * 60 : amount;
}

function pinDialogFragmentKey(fragment: ContentFragment, index: number): string {
  switch (fragment.type) {
    case "emote":
      return `e:${fragment.id}:${index}`;
    case "mention":
      return `m:${fragment.username}:${index}`;
    case "link":
      return `l:${index}:${fragment.url.slice(0, 24)}`;
    case "cheermote":
      return `c:${fragment.id}:${fragment.bits}:${index}`;
    default:
      return `t:${index}:${(fragment as { content?: string }).content?.slice(0, 12) ?? ""}`;
  }
}

function PinDialogMessageFragment({
  fragment,
  platform,
}: {
  fragment: ContentFragment;
  platform: ChatMessage["platform"];
}) {
  switch (fragment.type) {
    case "text":
      return <span className="break-words [overflow-wrap:anywhere]">{fragment.content}</span>;
    case "emote":
      return (
        <ChatEmote
          id={fragment.id}
          name={fragment.name}
          url={fragment.url}
          platform={platform}
          isAnimated={fragment.isAnimated}
          isZeroWidth={fragment.isZeroWidth}
        />
      );
    case "mention":
      return (
        <span className="mx-0.5 rounded bg-white/10 px-1 font-semibold text-[#EFEFF1]">
          {formatMentionLabel(fragment.username)}
        </span>
      );
    case "link":
      return (
        <a
          href={fragment.url}
          onClick={(event) => {
            event.preventDefault();
            window.electronAPI?.openExternal?.(fragment.url);
          }}
          className="break-all text-[#8ab4ff] hover:underline"
        >
          {fragment.text}
        </a>
      );
    case "cheermote":
      return (
        <span className="mx-1 inline-flex items-center font-bold text-purple-300">
          <img src={fragment.url} alt={fragment.name} className="mr-1 h-6 w-6" />
          {fragment.bits}
        </span>
      );
    default:
      return null;
  }
}

export interface TwitchPinMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Message being pinned, rendered with sender metadata and parsed emotes. */
  message: ChatMessage;
  /** Fires with the chosen duration (in seconds) or null for "no expiry". */
  onConfirm: (durationSeconds: number | null) => void;
  /** True while the pin mutation is in flight — disables the confirm button. */
  busy?: boolean;
}

export function TwitchPinMessageDialog({
  open,
  onOpenChange,
  message,
  onConfirm,
  busy = false,
}: TwitchPinMessageDialogProps) {
  const [selected, setSelected] = useState<DurationSelection>(DEFAULT_DURATION_SECONDS);
  const [customAmount, setCustomAmount] = useState("1");
  const [customUnit, setCustomUnit] = useState<CustomDurationUnit>("minutes");
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState(message.avatarUrl ?? "");
  const resolvedDuration = resolveDurationSelection(selected, customAmount, customUnit);
  const canConfirm = resolvedDuration !== undefined;

  const handleConfirm = () => {
    if (resolvedDuration === undefined) return;
    onConfirm(resolvedDuration);
  };
  const messageContent = message.content ?? [];
  const previewFragments =
    messageContent.length > 0
      ? messageContent
      : [{ type: "text" as const, content: message.rawContent || "" }];
  const displayName = message.displayName || message.username;
  const usernameColor = message.color || "#A970FF";

  useEffect(() => {
    const directAvatarUrl = message.avatarUrl ?? "";
    if (directAvatarUrl) {
      setResolvedAvatarUrl(directAvatarUrl);
      return;
    }

    setResolvedAvatarUrl("");
    if (!open || message.platform !== "twitch" || !message.username) return;

    const cacheKey = message.username.toLowerCase();
    const cached = avatarUrlByTwitchLogin.get(cacheKey);
    if (cached) {
      setResolvedAvatarUrl(cached);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        if (!window.electronAPI?.channels?.getByUsername) return;
        const result = (await window.electronAPI.channels.getByUsername({
          platform: "twitch",
          username: message.username,
        })) as ChannelLookupResult;
        const avatarUrl = result.success ? (result.data?.avatarUrl ?? "") : "";
        if (!avatarUrl) return;
        avatarUrlByTwitchLogin.set(cacheKey, avatarUrl);
        if (!cancelled) setResolvedAvatarUrl(avatarUrl);
      } catch {
        // The fallback initial remains visible if avatar lookup is unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [message.avatarUrl, message.platform, message.username, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl">
        <DialogHeader className="pb-4 border-b border-[var(--color-border)]">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <LuPin className="w-5 h-5 text-[var(--color-storm-primary)]" />
            {i18n.t("chat.pinMessage")}
          </DialogTitle>
          <DialogDescription className="text-[var(--color-foreground-muted)] pt-2">
            {i18n.t(
              "chat.chooseHowLongThisMessageShouldStayPinnedAnyoneInChatWillSeeItUntilYouUnpinItOrItExpires"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div
            className="mb-3 flex gap-3 rounded border border-[var(--color-border)] bg-white/5 px-3 py-3 text-sm text-[#EFEFF1]"
            data-testid="pin-dialog-preview"
          >
            <ProxiedImage
              src={resolvedAvatarUrl}
              alt={displayName}
              loading="eager"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-full object-cover"
              fallbackClassName="h-8 w-8 shrink-0 rounded-full text-sm"
            />
            <div className="min-w-0 flex-1">
              <div
                className="mb-1 truncate text-sm font-semibold leading-5"
                style={{ color: usernameColor }}
              >
                {displayName}
              </div>
              <div className="line-clamp-3 break-words leading-6 [overflow-wrap:anywhere]">
                {previewFragments.map((fragment, index) => (
                  <PinDialogMessageFragment
                    key={pinDialogFragmentKey(fragment, index)}
                    fragment={fragment}
                    platform={message.platform}
                  />
                ))}
              </div>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[#EFEFF1] mb-2">
              {i18n.t("chat.duration")}
            </legend>
            {DURATION_OPTIONS.map((opt) => (
              <label
                key={opt.label}
                className="flex items-center gap-2 cursor-pointer text-sm text-[#EFEFF1] hover:bg-white/5 px-2 py-1.5 rounded"
              >
                <input
                  type="radio"
                  name="pin-duration"
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                  className="cursor-pointer accent-[#9146FF]"
                />
                {opt.label}
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#EFEFF1] hover:bg-white/5 px-2 py-1.5 rounded">
              <input
                type="radio"
                name="pin-duration"
                checked={selected === CUSTOM_DURATION}
                onChange={() => setSelected(CUSTOM_DURATION)}
                className="cursor-pointer accent-[#9146FF]"
              />
              {i18n.t("chat.custom")}
            </label>
          </fieldset>

          {selected === CUSTOM_DURATION ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label={i18n.t("chat.customPinDuration")}
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
                onFocus={() => setSelected(CUSTOM_DURATION)}
                className="h-9 min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[#0A0A0D] px-3 text-sm text-[#EFEFF1] outline-none focus:border-[#9146FF]"
              />
              <select
                aria-label={i18n.t("chat.customPinDurationUnit")}
                value={customUnit}
                onChange={(event) => setCustomUnit(event.target.value as CustomDurationUnit)}
                className="h-9 rounded border border-[var(--color-border)] bg-[#0A0A0D] px-2 text-sm text-[#EFEFF1] outline-none focus:border-[#9146FF]"
              >
                <option value="seconds">{i18n.t("chat.secs")}</option>
                <option value="minutes">{i18n.t("chat.mins")}</option>
              </select>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {i18n.t("chat.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={busy || !canConfirm}
            className="bg-[#9146FF] hover:bg-[#9146FF]/90 text-white"
          >
            {busy ? i18n.t("chat.pinning") : i18n.t("chat.pinMessage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
