/**
 * ToastRoot — single sonner Toaster mount for the entire renderer.
 *
 * Imperative API: any component can call `toast.error(...)` /
 * `toast.success(...)` from `sonner` and the notification renders here.
 * Centralized so failure-mode UX (mod actions, pin/unpin, auth failures)
 * has one consistent surface across the app.
 */
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { Toaster } from "sonner";

const toastIconClass = "h-4 w-4";

const toastClassNames = {
  toast:
    "!w-[360px] !rounded-[8px] !border !border-[#333333] !bg-[#1a1a1a] !p-4 !text-white !shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
  title: "!text-sm !font-semibold !leading-5 !text-white",
  description: "!text-xs !font-medium !leading-5 !text-[#b2b2b2]",
  content: "!gap-1",
  icon: "!mt-0.5",
  closeButton:
    "!border-[#333333] !bg-[#252525] !text-white hover:!border-[#4a4d55] hover:!bg-[#2d2d2d]",
  actionButton: "!bg-white !font-bold !text-[#0f0f0f] hover:!opacity-90",
  cancelButton: "!bg-[#252525] !font-semibold !text-white hover:!bg-[#2d2d2d]",
  success: "!border-[#256b3a]",
  error: "!border-[#7f1d1d]",
  warning: "!border-[#92400e]",
  info: "!border-[#334155]",
};

export function ToastRoot() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      duration={5000}
      theme="dark"
      icons={{
        success: <CircleCheck aria-hidden="true" className={`${toastIconClass} text-[#7aff4d]`} />,
        error: <CircleX aria-hidden="true" className={`${toastIconClass} text-[#f87171]`} />,
        warning: (
          <TriangleAlert aria-hidden="true" className={`${toastIconClass} text-[#fbbf24]`} />
        ),
        info: <Info aria-hidden="true" className={`${toastIconClass} text-[#93c5fd]`} />,
      }}
      toastOptions={{
        classNames: toastClassNames,
      }}
    />
  );
}
