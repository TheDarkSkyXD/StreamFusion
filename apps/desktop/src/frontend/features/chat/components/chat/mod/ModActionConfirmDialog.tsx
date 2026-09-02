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

import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuArchive,
  LuBan,
  LuCircleX,
  LuClock,
  LuEraser,
  LuFingerprint,
  LuLoaderCircle,
  LuLock,
  LuMegaphone,
  LuRadio,
  LuRotateCcw,
  LuShield,
  LuShieldCheck,
  LuSquare,
  LuStar,
  LuTrash2,
  LuTriangleAlert,
  LuTrophy,
} from "react-icons/lu";

import { Button } from "@/components/ui/button";
import type { chatModerationEn } from "@/i18n/locales/en/chatModeration";
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
  | "warn"
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
  | "removeVip"
  // U25/U26 — engagement (predictions / polls) confirmations.
  | "predictionLock"
  | "predictionResolve"
  | "predictionCancel"
  | "pollTerminate"
  | "pollArchive";

interface ModActionCopy {
  icon: ReactNode;
  titleKey: ChatModerationKey;
  descriptionKey: ChatModerationKey;
  confirmLabelKey: ChatModerationKey;
  busyLabelKey: ChatModerationKey;
  /** Tailwind classes that paint the primary CTA. */
  confirmClass: string;
}

type ChatModerationKey = `chatModeration.${keyof typeof chatModerationEn.chatModeration & string}`;

const TWITCH_PURPLE = "bg-[#9146FF] hover:bg-[#9146FF]/90 text-white";
const DESTRUCTIVE_RED = "bg-red-600 hover:bg-red-600/90 text-white";
const WARNING_AMBER = "bg-amber-600 hover:bg-amber-600/90 text-white";
const RECOVERY_GREEN = "bg-emerald-600 hover:bg-emerald-600/90 text-white";

const MOD_ACTION_COPY: Record<ModActionType, ModActionCopy> = {
  ban: {
    icon: <LuBan className="w-5 h-5 text-red-500" />,
    titleKey: "chatModeration.banUserTitle",
    descriptionKey: "chatModeration.banUserDescription",
    confirmLabelKey: "chatModeration.banUser",
    busyLabelKey: "chatModeration.banning",
    confirmClass: DESTRUCTIVE_RED,
  },
  timeout: {
    icon: <LuClock className="w-5 h-5 text-amber-500" />,
    titleKey: "chatModeration.timeoutUserTitle",
    descriptionKey: "chatModeration.timeoutUserDescription",
    confirmLabelKey: "chatModeration.timeoutAction",
    busyLabelKey: "chatModeration.timingOut",
    confirmClass: WARNING_AMBER,
  },
  warn: {
    icon: <LuTriangleAlert className="w-5 h-5 text-amber-500" />,
    titleKey: "chatModeration.warnUserTitle",
    descriptionKey: "chatModeration.warnUserDescription",
    confirmLabelKey: "chatModeration.warnUser",
    busyLabelKey: "chatModeration.warning",
    confirmClass: WARNING_AMBER,
  },
  unban: {
    icon: <LuRotateCcw className="w-5 h-5 text-emerald-500" />,
    titleKey: "chatModeration.unbanUserTitle",
    descriptionKey: "chatModeration.unbanUserDescription",
    confirmLabelKey: "chatModeration.unbanUser",
    busyLabelKey: "chatModeration.unbanning",
    confirmClass: RECOVERY_GREEN,
  },
  delete: {
    icon: <LuTrash2 className="w-5 h-5 text-red-500" />,
    titleKey: "chatModeration.deleteMessageTitle",
    descriptionKey: "chatModeration.deleteMessageDescription",
    confirmLabelKey: "chatModeration.deleteMessage",
    busyLabelKey: "chatModeration.deleting",
    confirmClass: DESTRUCTIVE_RED,
  },
  raid: {
    icon: <LuRadio className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    titleKey: "chatModeration.startRaidTitle",
    descriptionKey: "chatModeration.startRaidDescription",
    confirmLabelKey: "chatModeration.startRaidAction",
    busyLabelKey: "chatModeration.startingRaid",
    confirmClass: TWITCH_PURPLE,
  },
  clear: {
    icon: <LuEraser className="w-5 h-5 text-red-500" />,
    titleKey: "chatModeration.clearChatTitle",
    descriptionKey: "chatModeration.clearChatDescription",
    confirmLabelKey: "chatModeration.clearChat",
    busyLabelKey: "chatModeration.clearing",
    confirmClass: DESTRUCTIVE_RED,
  },
  shield: {
    icon: <LuShield className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    titleKey: "chatModeration.enableShieldModeTitle",
    descriptionKey: "chatModeration.enableShieldModeDescription",
    confirmLabelKey: "chatModeration.enableShieldMode",
    busyLabelKey: "chatModeration.enabling",
    confirmClass: TWITCH_PURPLE,
  },
  shieldOff: {
    icon: <LuShield className="w-5 h-5 text-amber-500" />,
    titleKey: "chatModeration.disableShieldModeTitle",
    descriptionKey: "chatModeration.disableShieldModeDescription",
    confirmLabelKey: "chatModeration.disableShieldMode",
    busyLabelKey: "chatModeration.disabling",
    confirmClass: WARNING_AMBER,
  },
  commercial: {
    icon: <LuMegaphone className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    titleKey: "chatModeration.startCommercialTitle",
    descriptionKey: "chatModeration.startCommercialDescription",
    confirmLabelKey: "chatModeration.startCommercial",
    busyLabelKey: "chatModeration.starting",
    confirmClass: TWITCH_PURPLE,
  },
  uniqueChat: {
    icon: <LuFingerprint className="w-5 h-5 text-[var(--color-storm-primary)]" />,
    titleKey: "chatModeration.enableUniqueChatTitle",
    descriptionKey: "chatModeration.enableUniqueChatDescription",
    confirmLabelKey: "chatModeration.enableUniqueChat",
    busyLabelKey: "chatModeration.enabling",
    confirmClass: TWITCH_PURPLE,
  },
  addMod: {
    icon: <LuShieldCheck className="w-5 h-5 text-emerald-500" />,
    titleKey: "chatModeration.addModeratorTitle",
    descriptionKey: "chatModeration.addModeratorDescription",
    confirmLabelKey: "chatModeration.makeModerator",
    busyLabelKey: "chatModeration.adding",
    confirmClass: RECOVERY_GREEN,
  },
  removeMod: {
    icon: <LuShieldCheck className="w-5 h-5 text-amber-500" />,
    titleKey: "chatModeration.removeModeratorTitle",
    descriptionKey: "chatModeration.removeModeratorDescription",
    confirmLabelKey: "chatModeration.removeModerator",
    busyLabelKey: "chatModeration.removing",
    confirmClass: WARNING_AMBER,
  },
  addVip: {
    icon: <LuStar className="w-5 h-5 text-pink-400" />,
    titleKey: "chatModeration.addVipTitle",
    descriptionKey: "chatModeration.addVipDescription",
    confirmLabelKey: "chatModeration.makeVip",
    busyLabelKey: "chatModeration.adding",
    confirmClass: TWITCH_PURPLE,
  },
  removeVip: {
    icon: <LuStar className="w-5 h-5 text-amber-500" />,
    titleKey: "chatModeration.removeVipTitle",
    descriptionKey: "chatModeration.removeVipDescription",
    confirmLabelKey: "chatModeration.removeVip",
    busyLabelKey: "chatModeration.removing",
    confirmClass: WARNING_AMBER,
  },
  predictionLock: {
    icon: <LuLock className="w-5 h-5 text-amber-500" />,
    titleKey: "chatModeration.lockPredictionTitle",
    descriptionKey: "chatModeration.lockPredictionDescription",
    confirmLabelKey: "chatModeration.lockPrediction",
    busyLabelKey: "chatModeration.locking",
    confirmClass: WARNING_AMBER,
  },
  predictionResolve: {
    icon: <LuTrophy className="w-5 h-5 text-emerald-500" />,
    titleKey: "chatModeration.resolvePredictionTitle",
    descriptionKey: "chatModeration.resolvePredictionDescription",
    confirmLabelKey: "chatModeration.resolvePrediction",
    busyLabelKey: "chatModeration.resolving",
    confirmClass: RECOVERY_GREEN,
  },
  predictionCancel: {
    icon: <LuCircleX className="w-5 h-5 text-red-500" />,
    titleKey: "chatModeration.cancelPredictionTitle",
    descriptionKey: "chatModeration.cancelPredictionDescription",
    confirmLabelKey: "chatModeration.cancelPrediction",
    busyLabelKey: "chatModeration.canceling",
    confirmClass: DESTRUCTIVE_RED,
  },
  pollTerminate: {
    icon: <LuSquare className="w-5 h-5 text-amber-500" />,
    titleKey: "chatModeration.terminatePollTitle",
    descriptionKey: "chatModeration.terminatePollDescription",
    confirmLabelKey: "chatModeration.terminatePoll",
    busyLabelKey: "chatModeration.terminating",
    confirmClass: WARNING_AMBER,
  },
  pollArchive: {
    icon: <LuArchive className="w-5 h-5 text-[var(--color-foreground-muted)]" />,
    titleKey: "chatModeration.archivePollTitle",
    descriptionKey: "chatModeration.archivePollDescription",
    confirmLabelKey: "chatModeration.archivePoll",
    busyLabelKey: "chatModeration.archiving",
    confirmClass: TWITCH_PURPLE,
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
  extraSlot?: (props: { onDataChange: (data: unknown) => void; disabled: boolean }) => ReactNode;
  confirmDisabled?: boolean;
}

export function ModActionConfirmDialog({
  open,
  onOpenChange,
  actionType,
  targetPreview,
  onConfirm,
  busy = false,
  extraSlot,
  confirmDisabled = false,
}: ModActionConfirmDialogProps) {
  const { t } = useTranslation();
  const copy = MOD_ACTION_COPY[actionType];
  const [extraData, setExtraData] = useState<unknown>(undefined);

  const handleConfirm = () => {
    // Parent decides whether to close on success — we never close ourselves.
    onConfirm(extraData);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && busy) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        hideCloseButton={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        className="sm:max-w-[440px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl"
      >
        <DialogHeader className="pb-4 border-b border-[var(--color-border)]">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            {copy.icon}
            {t(copy.titleKey)}
          </DialogTitle>
          <DialogDescription className="text-[var(--color-foreground-muted)] pt-2">
            {t(copy.descriptionKey)}
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
          {busy ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 flex items-center gap-2 text-sm text-amber-200"
            >
              <LuLoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              {t(copy.busyLabelKey)}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("chatModeration.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={busy || confirmDisabled}
            className={copy.confirmClass}
          >
            {busy ? t(copy.busyLabelKey) : t(copy.confirmLabelKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
