/**
 * TwitchPinMessageDialog
 *
 * Modal a mod uses to pick a duration before pinning a chat message.
 * Offers Helix-compatible timed choices: 5m, 15m, 30m, or no expiry.
 * Default = 30m (Twitch Helix's maximum timed pin duration).
 *
 * The actual pin mutation runs in the parent (`TwitchChat`) so the dialog
 * stays presentation-only — it just collects the duration and reports back
 * via `onConfirm(durationSeconds | null)`.
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
  { label: "5 minutes", value: 5 * 60 },
  { label: "15 minutes", value: 15 * 60 },
  { label: "30 minutes", value: 30 * 60 },
  { label: "No expiry", value: null },
];

const DEFAULT_DURATION_SECONDS = 30 * 60;

export interface TwitchPinMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short preview of the message being pinned (shown in the dialog body). */
  messagePreview: string;
  /** Fires with the chosen duration (in seconds) or null for "no expiry". */
  onConfirm: (durationSeconds: number | null) => void;
  /** True while the pin mutation is in flight — disables the confirm button. */
  busy?: boolean;
}

export function TwitchPinMessageDialog({
  open,
  onOpenChange,
  messagePreview,
  onConfirm,
  busy = false,
}: TwitchPinMessageDialogProps) {
  const [selected, setSelected] = useState<number | null>(DEFAULT_DURATION_SECONDS);

  const handleConfirm = () => {
    onConfirm(selected);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl">
        <DialogHeader className="pb-4 border-b border-[var(--color-border)]">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <LuPin className="w-5 h-5 text-[var(--color-storm-primary)]" />
            Pin message
          </DialogTitle>
          <DialogDescription className="text-[var(--color-foreground-muted)] pt-2">
            Choose how long this message should stay pinned. Anyone in chat will see it until you
            unpin it or it expires.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div
            className="text-sm text-[#EFEFF1] mb-3 px-3 py-2 rounded bg-white/5 border border-[var(--color-border)] line-clamp-3 break-words"
            data-testid="pin-dialog-preview"
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
                  name="pin-duration"
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                  className="cursor-pointer accent-[#9146FF]"
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
            onClick={handleConfirm}
            disabled={busy}
            className="bg-[#9146FF] hover:bg-[#9146FF]/90 text-white"
          >
            {busy ? "Pinning…" : "Pin message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
