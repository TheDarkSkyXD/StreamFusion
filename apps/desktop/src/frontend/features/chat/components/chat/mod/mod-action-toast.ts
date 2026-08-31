import { toast } from "sonner";

export function showModActionSuccessToast(message: string): void {
  toast.success(message);
}
