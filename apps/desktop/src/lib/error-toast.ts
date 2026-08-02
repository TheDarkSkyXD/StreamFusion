import { type ExternalToast, toast } from "sonner";

const ERROR_TOAST_DURATION = 15_000;

export function showErrorToast(title: string, options: ExternalToast = {}) {
  const { description } = options;
  const copyText = typeof description === "string" ? `${title}\n${description}` : title;

  return toast.error(title, {
    ...options,
    duration: options.duration ?? ERROR_TOAST_DURATION,
    action: {
      label: "Copy error",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(copyText);
          toast.success("Error copied");
        } catch (error) {
          toast.error("Couldn't copy error", {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  });
}
