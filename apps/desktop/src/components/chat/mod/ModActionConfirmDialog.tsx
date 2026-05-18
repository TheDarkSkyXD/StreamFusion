/**
 * ModActionConfirmDialog
 *
 * Generic confirmation modal reused by every mod-action surface (hover
 * toolbar, inline strip, user popout). Title, description, and the primary
 * CTA label are derived from `actionType` via {@link MOD_ACTION_COPY}.
 *
 * The dialog is presentation-only: it collects optional `extraData` from an
 * action-specific slot (e.g. the timeout duration picker) and fires
 * `onConfirm(extraData)` when the operator confirms. The parent owns the
 * mutation and decides whether to close the dialog on success or keep it
 * open on failure — this component never closes itself after a confirm.
 *
 * Visual language mirrors `TwitchPinMessageDialog` so the family of mod
 * dialogs feels cohesive without sharing implementation.
 */

import { useState, type ReactNode } from "react";
import {
  LuBan,
  LuClock,
  LuRotateCcw,
  LuTrash2,
  LuRadio,
  LuEraser,
  LuShield,
  LuMegaphone,
  LuFingerprint,
  LuShieldCheck,
  LuStar,
} from "react-icons/lu";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ModActionType =
  | "ban"
  | "timeout"
  | "unban"
  | "delete"
  | "raid"
  | "clear"
  | "shield"
  | "shieldOff"
  | "commercial"
  | "uniqueChat"
  // U17 — broadcaster-only role mutations on the user popout footer.
  | "addMod"
  | "removeMod"
  | "addVip"
  | "removeVip";

interface ModActionCopy {
  icon: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  /** Tailwind classes that paint the primary CTA. */
  confirmClass: string;
}

const TWITCH_PURPLE = "bg-[#9146FF] hover:bg-[#9146FF]/90 text-white";
const DESTRUCTIVE_RED = "bg-red-600 hover:bg-red-600/90 text-white";
const WARNING_AMBER = "bg-amber-600 hover:bg-amber-600/90 text-white";
const RECOVERY_GREEN = "bg-emerald-600 hover:bg-emerald-600/90 text-white";

const MOD_ACTION_COPY: Record<ModActionType, ModActionCopy> = {
  ban: {
    icon: <LuBan className="w-5 h-5 text-red-500" />,
    title: "Ban user",
    description:
      "Permanently remove this user from chat. They can't send messages until you unban them.",
    confirmLabel: "Ban user",
    busyLabel: "Banning…",
    confirmClass: DESTRUCTIVE_RED,
  },
  timeout: {
    icon: <LuClock className="w-5 h-5 text-amber-500" />,
    title: "Time out user",
    description:
      "Silence this user for a set duration. They rejoin chat automatically when the timer ends.",
    confirmLabel: "Time out",
    busyLabel: "Timing out…",
    confirmClass: WARNING_AMBER,
  },
  unban: {
    icon: <LuRotateCcw className="w-5 h-5 text-emerald-500" />,
    title: "Unban user",
    description:
      "Restore this user's ability to chat. Their previous timeout or ban will be lifted.",
    confirmLabel: "Unban user",
    busyLabel: "Unbanning…",
    confirmClass: RECOVERY_GREEN,
  },
  delete: {
    icon: <LuTrash2 className="w-5 h-5 text-red-500" />,
    title: "Delete message",
    description:
      "Remove this message from chat for everyone. The user is not warned or timed out.",
    confirmLabel: "Delete message",
    busyLabel: "Deleting…",
    confirmClass: DESTRUCTIVE_RED,
  },
  raid: {
    icon: <LuRadio className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    title: "Start raid",
    description:
      "Send your viewers to another channel when your stream ends. You can cancel before the raid lands.",
    confirmLabel: "Start raid",
    busyLabel: "Starting raid…",
    confirmClass: TWITCH_PURPLE,
  },
  clear: {
    icon: <LuEraser className="w-5 h-5 text-red-500" />,
    title: "Clear chat",
    description:
      "Wipe every message currently visible in chat. The history is cleared for all viewers.",
    confirmLabel: "Clear chat",
    busyLabel: "Clearing…",
    confirmClass: DESTRUCTIVE_RED,
  },
  shield: {
    icon: <LuShield className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    title: "Enable Shield Mode",
    description:
      "Apply your strict moderation preset to lock chat down during a raid or harassment wave.",
    confirmLabel: "Enable Shield Mode",
    busyLabel: "Enabling…",
    confirmClass: TWITCH_PURPLE,
  },
  shieldOff: {
    icon: <LuShield className="w-5 h-5 text-amber-500" />,
    title: "Disable Shield Mode",
    description:
      "Lift Shield Mode and return chat to its normal moderation settings.",
    confirmLabel: "Disable Shield Mode",
    busyLabel: "Disabling…",
    confirmClass: WARNING_AMBER,
  },
  commercial: {
    icon: <LuMegaphone className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    title: "Start commercial",
    description:
      "Run an ad break on your channel. Viewers without a sub will see the ad immediately.",
    confirmLabel: "Start commercial",
    busyLabel: "Starting…",
    confirmClass: TWITCH_PURPLE,
  },
  uniqueChat: {
    icon: <LuFingerprint className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    title: "Enable Unique Chat",
    description:
      "Block users from posting messages identical to a recent one. Helpful against copy-paste spam.",
    confirmLabel: "Enable Unique Chat",
    busyLabel: "Enabling…",
    confirmClass: TWITCH_PURPLE,
  },
  addMod: {
    icon: <LuShieldCheck className="w-5 h-5 text-emerald-500" />,
    title: "Make moderator",
    description:
      "Grant this user moderator privileges on your channel. They'll be able to time out, ban, and delete messages.",
    confirmLabel: "Make moderator",
    busyLabel: "Adding…",
    confirmClass: RECOVERY_GREEN,
  },
  removeMod: {
    icon: <LuShieldCheck className="w-5 h-5 text-amber-500" />,
    title: "Remove moderator",
    description:
      "Revoke this user's moderator privileges. They'll lose access to all mod actions on your channel.",
    confirmLabel: "Remove moderator",
    busyLabel: "Removing…",
    confirmClass: WARNING_AMBER,
  },
  addVip: {
    icon: <LuStar className="w-5 h-5 text-pink-400" />,
    title: "Make VIP",
    description:
      "Grant this user VIP status. They'll bypass slow / followers / subscribers-only mode and receive a VIP badge.",
    confirmLabel: "Make VIP",
    busyLabel: "Adding…",
    confirmClass: TWITCH_PURPLE,
  },
  removeVip: {
    icon: <LuStar className="w-5 h-5 text-amber-500" />,
    title: "Remove VIP",
    description:
      "Revoke this user's VIP status. They'll lose the VIP badge and chat-mode bypass.",
    confirmLabel: "Remove VIP",
    busyLabel: "Removing…",
    confirmClass: WARNING_AMBER,
  },
};

export interface ModActionConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: ModActionType;
  /** What this action targets — a message preview, a user identity, or both. */
  targetPreview: ReactNode;
  /**
   * Fired when the user clicks the primary CTA. `extraData` is whatever the
   * `extraSlot` collected (e.g. `{ durationSeconds: 600 }` from the timeout
   * picker; `{ targetChannelId: "...", targetChannelName: "..." }` from the
   * raid picker; for actions with no extra UI, undefined).
   */
  onConfirm: (extraData?: unknown) => void | Promise<void>;
  busy?: boolean;
  /**
   * Action-specific UI plugged in below the target preview. Receives a
   * `(data) => void` callback the slot uses to lift collected data, plus the
   * current `disabled` (true when busy).
   */
  extraSlot?: (props: {
    onDataChange: (data: unknown) => void;
    disabled: boolean;
  }) => ReactNode;
}

export function ModActionConfirmDialog({
  open,
  onOpenChange,
  actionType,
  targetPreview,
  onConfirm,
  busy = false,
  extraSlot,
}: ModActionConfirmDialogProps) {
  const copy = MOD_ACTION_COPY[actionType];
  const [extraData, setExtraData] = useState<unknown>(undefined);

  const handleConfirm = () => {
    // Parent decides whether to close on success — we never close ourselves.
    onConfirm(extraData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl">
        <DialogHeader className="pb-4 border-b border-[var(--color-border)]">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            {copy.icon}
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-[var(--color-foreground-muted)] pt-2">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div
            className="text-sm text-[#EFEFF1] mb-3 px-3 py-2 rounded bg-white/5 border border-[var(--color-border)] line-clamp-3 break-words"
            data-testid="mod-action-target-preview"
          >
            {targetPreview}
          </div>

          {extraSlot ? (
            <div data-testid="mod-action-extra-slot">
              {extraSlot({ onDataChange: setExtraData, disabled: busy })}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={busy}
            className={copy.confirmClass}
          >
            {busy ? copy.busyLabel : copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
