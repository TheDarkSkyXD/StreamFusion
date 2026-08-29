import { toast } from "sonner";

export function showModActionSuccessToast(message: string, isDev = import.meta.env.DEV): void {
  if (!isDev) return;
  toast.success(message);
}
