import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDownloadDuplicateConfirmationStore } from "@/store/download-duplicate-confirmation-store";

export function DownloadDuplicateConfirmationDialog() {
  const { t } = useTranslation();
  const pending = useDownloadDuplicateConfirmationStore((state) => state.pending);
  const resolve = useDownloadDuplicateConfirmationStore((state) => state.resolve);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const contentKind = pending?.kind === "video" ? "VOD" : "clip";

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && resolve(false)}>
      <DialogContent
        role="alertdialog"
        hideCloseButton
        className="border-[var(--color-border)] bg-[var(--color-background-elevated)] shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("mediaLibrary.duplicateTitle")}</DialogTitle>
          <DialogDescription>
            {t("mediaLibrary.duplicateDescription", {
              title: pending?.title,
              kind: contentKind,
              defaultValue: "{{title}} is already in Downloads. Download this {{kind}} again?",
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="secondary"
            onClick={() => resolve(false)}
          >
            {t("mediaLibrary.cancel")}
          </Button>
          <Button type="button" onClick={() => resolve(true)}>
            {t("mediaLibrary.downloadAgain")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
