import { type ExternalToast, toast } from "sonner";

import { i18n } from "@/i18n";

const ERROR_TOAST_DURATION = 15_000;

export function showErrorToast(title: string, options: ExternalToast = {}) {
  const { description } = options;
  const copyText = typeof description === "string" ? `${title}\n${description}` : title;

  return toast.error(title, {
    ...options,
    duration: options.duration ?? ERROR_TOAST_DURATION,
    action: {
      label: i18n.t("common.copyError"),
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(copyText);
          toast.success(i18n.t("common.errorCopied"));
        } catch (error) {
          toast.error(i18n.t("common.copyErrorFailed"), {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  });
}
