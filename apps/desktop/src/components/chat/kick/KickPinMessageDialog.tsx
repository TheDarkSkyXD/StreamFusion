/**
 * KickPinMessageDialog
 *
 * Duration picker for pinning a Kick chat message. Mirrors the Twitch pin
 * dialog's shape so the mod UX is consistent across both platforms.
 *
 * Kick's v2 pin endpoint accepts a `duration` parameter in seconds. KickTalk
 * hardcodes 1200s (20 min) as a single default; Kick's web UI offers a
 * short menu (~20m / 1h / 24h / Until disabled). We surface the same four
 * choices as Twitch for symmetry, with 20 minutes as the default since
 * that matches Kick's own "short" recommendation.
 */

import { useState } from "react";
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

interface DurationOption {
  label: string;
  value: number | null;
}

const DURATION_OPTIONS: DurationOption[] = [
  { label: "20 minutes", value: 20 * 60 },
  { label: "1 hour", value: 60 * 60 },
  { label: "24 hours", value: 24 * 60 * 60 },
  { label: "Until unpinned", value: null },
];

const DEFAULT_DURATION_SECONDS = 20 * 60; // 20 minutes — Kick's short default.

export interface KickPinMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short preview of the message being pinned. */
  messagePreview: string;
  /** Fires with the chosen duration in seconds, or null for "until unpinned". */
  onConfirm: (durationSeconds: number | null) => void;
  /** True while the pin mutation is in flight. */
  busy?: boolean;
}

export function KickPinMessageDialog({
  open,
  onOpenChange,
  messagePreview,
  onConfirm,
  busy = false,
}: KickPinMessageDialogProps) {
  const [selected, setSelected] = useState<number | null>(DEFAULT_DURATION_SECONDS);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl">
        <DialogHeader className="pb-4 border-b border-[var(--color-border)]">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <LuPin className="w-5 h-5 text-[#53FC18]" />
            Pin message
          </DialogTitle>
          <DialogDescription className="text-[var(--color-foreground-muted)] pt-2">
            Choose how long this message should stay pinned. Anyone in chat
            will see it until you unpin it or it expires.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div
            className="text-sm text-[#EFEFF1] mb-3 px-3 py-2 rounded bg-white/5 border border-[var(--color-border)] line-clamp-3 break-words"
            data-testid="kick-pin-dialog-preview"
          >
            {messagePreview}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[#EFEFF1] mb-2">Duration</legend>
            {DURATION_OPTIONS.map((opt) => (
              <label
                key={opt.label}
                className="flex items-center gap-2 cursor-pointer text-sm text-[#EFEFF1] hover:bg-white/5 px-2 py-1.5 rounded"
              >
                <input
                  type="radio"
                  name="kick-pin-duration"
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                  className="cursor-pointer accent-[#53FC18]"
                />
                {opt.label}
              </label>
            ))}
          </fieldset>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(selected)}
            disabled={busy}
            className="bg-[#53FC18] hover:bg-[#53FC18]/90 text-black font-semibold"
          >
            {busy ? "Pinning…" : "Pin message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
